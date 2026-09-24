import os
import sys
import argparse
import re
import asyncio
import hashlib
import time
import inspect
import multiprocessing
import math
from collections import OrderedDict
from concurrent.futures import ProcessPoolExecutor
from contextlib import suppress
from uuid import uuid4
import uvicorn
import aiohttp
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from typing import List, Optional

# --- Directory Configuration ---
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = SCRIPT_DIR
BASE_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))

OUTPUT_DIR = os.path.join(BASE_DIR, "output")
VOICES_DIR = os.path.join(BASE_DIR, "voices")
LOCAL_VOICES_DIR = os.path.join(SCRIPT_DIR, "voices")
CHECKPOINTS_DIR = os.path.join(PROJECT_DIR, "checkpoints")

# --- Cleanup Configuration ---
MAX_OUTPUT_AGE_MINUTES = 30  # Files older than this will be deleted
CLEANUP_INTERVAL_SECONDS = 300  # How often to run the cleanup check (5 mins)

# --- Job Lease/Cancellation Configuration ---
DEFAULT_LEASE_TTL_SECONDS = 20
MIN_LEASE_TTL_SECONDS = 5
MAX_LEASE_TTL_SECONDS = 300
JOB_RETENTION_SECONDS = 300

# Add project dir to path for imports
if PROJECT_DIR not in sys.path:
    sys.path.append(PROJECT_DIR)

# --- Global Objects ---
inference_service = None
callback_session = None
callback_tasks = set()
cleanup_task = None
voice_catalogue = OrderedDict()
jobs = {}
jobs_lock = asyncio.Lock()

# Torch and IndexTTS are imported only in the spawned worker. Stopping that
# process releases weights, conditioning tensors, allocator pools AND CUDA context.
worker_runtime = None
worker_load_error = None


class ReferenceCache:
    """Byte- and entry-bounded LRU of complete upstream conditioning bundles."""

    SPEAKER_FIELDS = ('cache_spk_cond', 'cache_s2mel_style', 'cache_s2mel_prompt', 'cache_mel')
    EMOTION_FIELDS = ('cache_emo_cond',)

    def __init__(self, max_entries=32, max_bytes=256 * 1024 * 1024):
        self.max_entries = max_entries
        self.max_bytes = max_bytes
        self.entries = OrderedDict()
        self.bytes_used = 0

    @staticmethod
    def file_key(kind, path):
        path = os.path.normcase(os.path.realpath(path))
        stat = os.stat(path)
        return kind, path, stat.st_mtime_ns, stat.st_size

    def _remove(self, key):
        _, size = self.entries.pop(key)
        self.bytes_used -= size

    def get(self, key):
        # Replacing a reference in place must never keep its old conditioning.
        for old in list(self.entries):
            if old[:2] == key[:2] and old != key:
                self._remove(old)
        entry = self.entries.get(key)
        if entry is None:
            return None
        self.entries.move_to_end(key)
        return entry[0]

    def put(self, key, values):
        if key in self.entries:
            self._remove(key)
        if any(value is None for value in values):
            return
        # Account for underlying storages, including views, without retaining
        # copies or autograd graphs. Shared storage is counted once per bundle.
        storages = {}
        for value in values:
            storage = value.untyped_storage()
            storages[(str(value.device), storage.data_ptr())] = storage.nbytes()
        size = sum(storages.values())
        if self.max_entries <= 0 or size > self.max_bytes:
            return
        while self.entries and (len(self.entries) >= self.max_entries or self.bytes_used + size > self.max_bytes):
            self._remove(next(iter(self.entries)))
        self.entries[key] = (values, size)
        self.bytes_used += size

    @classmethod
    def clear_model_slots(cls, model):
        for field in cls.SPEAKER_FIELDS + cls.EMOTION_FIELDS + ('cache_spk_audio_prompt', 'cache_emo_audio_prompt'):
            setattr(model, field, None)

    def restore(self, model, speaker_key, emotion_key):
        self.clear_model_slots(model)
        hits = {}
        for kind, key, fields, path_field in (
            ('speaker', speaker_key, self.SPEAKER_FIELDS, 'cache_spk_audio_prompt'),
            ('emotion', emotion_key, self.EMOTION_FIELDS, 'cache_emo_audio_prompt'),
        ):
            values = self.get(key)
            hits[kind] = values is not None
            if values is not None:
                for field, value in zip(fields, values):
                    setattr(model, field, value)
                setattr(model, path_field, key[1])
        return hits

    def capture(self, model, speaker_key, emotion_key):
        self.put(speaker_key, tuple(getattr(model, field) for field in self.SPEAKER_FIELDS))
        self.put(emotion_key, tuple(getattr(model, field) for field in self.EMOTION_FIELDS))


class InferenceRuntime:
    """Lives entirely in one worker process; never used concurrently."""

    def __init__(self, options):
        import yaml
        import torch
        self.torch = torch
        self.duration_factor = options.get('duration_factor', 0.90)
        self.emotion_alpha = options.get('emotion_alpha', 0.75)
        model_dir = options['model_dir']
        cfg_path = os.path.join(model_dir, 'config.yaml')
        with open(cfg_path, encoding='utf-8') as config_file:
            config = yaml.safe_load(config_file)
        self.version = options['model_version']
        if self.version == 'auto':
            self.version = '2.5' if str(config.get('version', '')).startswith('2.5') else '2'
        if self.version == '2.5':
            from indextts.infer_v2_5 import IndexTTS2
        else:
            from indextts.infer_v2 import IndexTTS2
        kwargs = dict(cfg_path=cfg_path, model_dir=model_dir,
                      use_cuda_kernel=options['cuda_kernel'], use_deepspeed=False)
        kwargs['use_bf16' if self.version == '2.5' else 'use_fp16'] = True
        parameters = inspect.signature(IndexTTS2).parameters
        if 'use_qwen_emo' in parameters:
            kwargs['use_qwen_emo'] = False
        for flag in ('use_accel', 'use_torch_compile'):
            if options[flag]:
                if flag not in parameters:
                    raise RuntimeError(f'This IndexTTS checkout does not support {flag}.')
                kwargs[flag] = True
        print(f'[IndexTTS] Loading {self.version} in worker {os.getpid()}...', flush=True)
        self.model = IndexTTS2(**kwargs)
        self.language = options['language']
        self.cache = ReferenceCache(options['cache_entries'], options['cache_mb'] * 1024 * 1024)
        required = ReferenceCache.SPEAKER_FIELDS + ReferenceCache.EMOTION_FIELDS
        if not all(hasattr(self.model, field) for field in required):
            raise RuntimeError('Unsupported IndexTTS conditioning cache layout; check the upstream version.')

    def infer(self, text, voice_path, output_path, emotion_path):
        speaker_key = self.cache.file_key('speaker', voice_path)
        emotion_key = self.cache.file_key('emotion', emotion_path or voice_path)
        hits = self.cache.restore(self.model, speaker_key, emotion_key)
        kwargs = dict(spk_audio_prompt=speaker_key[1], text=text, output_path=output_path,
                      emo_audio_prompt=emotion_key[1] if emotion_path else None,
                      emo_alpha=getattr(self, 'emotion_alpha', 0.75),
                      use_random=False, verbose=False)
        if self.version == '2.5':
            kwargs['lang'] = self.language
            kwargs['duration_factor'] = getattr(self, 'duration_factor', 0.90)
        started = time.perf_counter()
        # Publish only complete WAVs. Failed regeneration must not expose an old
        # or partially written file through a successful progress callback.
        temporary_path = output_path + f'.{uuid4().hex}.tmp.wav'
        kwargs['output_path'] = temporary_path
        try:
            with self.torch.inference_mode():
                self.model.infer(**kwargs)
            if not os.path.isfile(temporary_path) or os.path.getsize(temporary_path) <= 44:
                raise RuntimeError('IndexTTS did not produce a complete WAV file.')
            # Do not retain conditioning if a reference was replaced mid-call.
            if (speaker_key == self.cache.file_key('speaker', voice_path)
                    and emotion_key == self.cache.file_key('emotion', emotion_path or voice_path)):
                self.cache.capture(self.model, speaker_key, emotion_key)
            os.replace(temporary_path, output_path)
            return dict(speaker_cache_hit=hits['speaker'], emotion_cache_hit=hits['emotion'],
                        inference_seconds=round(time.perf_counter() - started, 3),
                        reference_cache_mb=round(self.cache.bytes_used / (1024 * 1024), 2))
        finally:
            self.cache.clear_model_slots(self.model)
            with suppress(FileNotFoundError):
                os.remove(temporary_path)


def run_indextts_inference(options, text, voice_path, output_path, emotion_path=None):
    """Process entry point. Return plain data so exceptions cannot retain tensors."""
    global worker_runtime, worker_load_error
    load_seconds = 0.0
    try:
        if worker_load_error:
            raise RuntimeError(worker_load_error)
        if worker_runtime is None:
            started = time.perf_counter()
            try:
                worker_runtime = InferenceRuntime(options)
            except Exception as exc:
                worker_load_error = f'IndexTTS initialization failed: {exc}'
                raise RuntimeError(worker_load_error) from None
            load_seconds = time.perf_counter() - started
        result = worker_runtime.infer(text, voice_path, output_path, emotion_path)
        result['model_load_seconds'] = round(load_seconds, 3)
        return result
    except Exception as exc:
        return {'error': str(exc)}


class InferenceService:
    """Keep a single GPU worker while batches are pending, unload when idle."""

    def __init__(self, options, idle_seconds=5):
        self.options = options
        self.idle_seconds = idle_seconds
        self.pool = None
        self.active_batches = 0
        self.idle_task = None
        self.closing_task = None
        self.lock = asyncio.Lock()
        self.closed = False

    def begin_batch(self):
        if self.closed:
            raise RuntimeError('TTS service is shutting down.')
        self.active_batches += 1
        if self.idle_task:
            self.idle_task.cancel()
            self.idle_task = None

    def end_batch(self):
        self.active_batches -= 1
        if not self.active_batches and self.idle_seconds >= 0 and not self.closed:
            self.idle_task = asyncio.create_task(self._unload_when_idle())

    async def _unload_when_idle(self):
        await asyncio.sleep(self.idle_seconds)
        self.idle_task = None
        if not self.active_batches:
            await self._close_worker()

    async def _close_worker(self):
        # Detach synchronously before yielding; new work waits for full exit so
        # the old and new models can never overlap in VRAM.
        pool, self.pool = self.pool, None
        if pool is not None:
            self.closing_task = asyncio.create_task(asyncio.to_thread(pool.shutdown, wait=True))
            await asyncio.shield(self.closing_task)
            print('[IndexTTS] Worker stopped; model and CUDA memory released.', flush=True)

    async def infer(self, *args, job_id=None):
        queued = time.perf_counter()
        async with self.lock:
            queue_seconds = time.perf_counter() - queued
            if self.closed:
                raise RuntimeError('TTS service is shutting down.')
            if job_id is not None:
                cancelled, reason = await get_job_cancellation_state(job_id)
                if cancelled:
                    return {'error': f'Cancelled: {reason}', 'queue_seconds': round(queue_seconds, 3)}
            if self.closing_task:
                await asyncio.shield(self.closing_task)
                self.closing_task = None
            if self.pool is None:
                self.pool = ProcessPoolExecutor(max_workers=1, mp_context=multiprocessing.get_context('spawn'))
            future = asyncio.get_running_loop().run_in_executor(self.pool, run_indextts_inference, self.options, *args)
            try:
                result = await asyncio.shield(future)
            except asyncio.CancelledError:
                # A running CUDA call cannot be cancelled by cancelling its
                # asyncio waiter. Drain it before releasing the lock/worker.
                with suppress(Exception):
                    await asyncio.shield(future)
                raise
            result['queue_seconds'] = round(queue_seconds, 3)
            return result

    async def close(self):
        self.closed = True
        if self.idle_task:
            self.idle_task.cancel()
            with suppress(asyncio.CancelledError):
                await self.idle_task
        async with self.lock:
            if self.closing_task:
                await asyncio.shield(self.closing_task)
            await self._close_worker()


def _now() -> float:
    return time.time()


def _normalize_lease_ttl(ttl: Optional[int]) -> int:
    if ttl is None:
        return DEFAULT_LEASE_TTL_SECONDS
    return max(MIN_LEASE_TTL_SECONDS, min(MAX_LEASE_TTL_SECONDS, int(ttl)))


async def register_or_refresh_job(job_id: str, context_hash: Optional[str], lease_ttl_seconds: Optional[int]):
    ttl = _normalize_lease_ttl(lease_ttl_seconds)
    now_ts = _now()
    expires_at = now_ts + ttl

    async with jobs_lock:
        existing = jobs.get(job_id)
        if existing:
            existing_hash = existing.get("context_hash")
            if context_hash and existing_hash and existing_hash != context_hash:
                raise ValueError("job_id already exists with a different context_hash")
            if context_hash and not existing_hash:
                existing["context_hash"] = context_hash
            existing["expires_at"] = expires_at
            existing["cancelled"] = False
            existing["cancel_reason"] = None
            existing["finished"] = False
            existing["updated_at"] = now_ts
            return existing

        entry = {
            "job_id": job_id,
            "context_hash": context_hash,
            "expires_at": expires_at,
            "cancelled": False,
            "cancel_reason": None,
            "finished": False,
            "updated_at": now_ts
        }
        jobs[job_id] = entry
        return entry


async def renew_job_lease(job_id: str, context_hash: Optional[str], lease_ttl_seconds: Optional[int]):
    ttl = _normalize_lease_ttl(lease_ttl_seconds)
    now_ts = _now()

    async with jobs_lock:
        entry = jobs.get(job_id)
        if not entry:
            return None

        existing_hash = entry.get("context_hash")
        if context_hash and existing_hash and existing_hash != context_hash:
            raise ValueError("context_hash mismatch for job lease renewal")
        if context_hash and not existing_hash:
            entry["context_hash"] = context_hash

        entry["expires_at"] = now_ts + ttl
        entry["updated_at"] = now_ts
        return dict(entry)


async def cancel_jobs(job_id: Optional[str], context_hash: Optional[str], cancel_all: bool, reason: str):
    now_ts = _now()
    cancelled = 0

    async with jobs_lock:
        for jid, entry in jobs.items():
            should_cancel = False
            if cancel_all:
                should_cancel = True
            elif job_id and jid == job_id:
                should_cancel = True
            elif context_hash and entry.get("context_hash") == context_hash:
                should_cancel = True

            if should_cancel and not entry.get("cancelled", False):
                entry["cancelled"] = True
                entry["cancel_reason"] = reason
                entry["updated_at"] = now_ts
                cancelled += 1

    return cancelled


async def get_job_cancellation_state(job_id: str):
    now_ts = _now()
    async with jobs_lock:
        entry = jobs.get(job_id)
        if not entry:
            return True, "unknown_job"

        if entry.get("cancelled", False):
            return True, entry.get("cancel_reason") or "cancelled"

        if now_ts > entry.get("expires_at", 0):
            entry["cancelled"] = True
            entry["cancel_reason"] = "lease_expired"
            entry["updated_at"] = now_ts
            return True, "lease_expired"

        return False, None


async def mark_job_finished(job_id: str):
    async with jobs_lock:
        entry = jobs.get(job_id)
        if entry:
            entry["finished"] = True
            entry["updated_at"] = _now()


async def cleanup_job_registry():
    now_ts = _now()
    async with jobs_lock:
        to_delete = []
        for jid, entry in jobs.items():
            age = now_ts - entry.get("updated_at", now_ts)
            is_finished = entry.get("finished", False)
            is_cancelled = entry.get("cancelled", False)
            is_expired = now_ts > entry.get("expires_at", 0)

            if (is_finished or is_cancelled or is_expired) and age > JOB_RETENTION_SECONDS:
                to_delete.append(jid)

        for jid in to_delete:
            jobs.pop(jid, None)


# --- Data Models ---
class DialogueLine(BaseModel):
    index: int
    character: str
    text: str
    originaltext: str
    crc: str
    gender: Optional[str] = Field(None, description="'male', 'female', or 'narrator'")
    mood: Optional[str] = Field(None, description="Optional emotional reference mood (e.g., 'angry', 'happy')")
    generic_voice_profile: Optional[str] = Field(None, description="Optional semantic generic voice profile key (e.g., 'old_man', 'monster').")


class TTSRequest(BaseModel):
    lines: List[DialogueLine]
    project_voices_path: Optional[str] = None
    callback_url: Optional[str] = None
    job_id: Optional[str] = None
    context_hash: Optional[str] = None
    lease_ttl_seconds: Optional[int] = Field(None, ge=MIN_LEASE_TTL_SECONDS, le=MAX_LEASE_TTL_SECONDS)


class LeaseRequest(BaseModel):
    job_id: str
    context_hash: Optional[str] = None
    lease_ttl_seconds: Optional[int] = Field(None, ge=MIN_LEASE_TTL_SECONDS, le=MAX_LEASE_TTL_SECONDS)


class CancelRequest(BaseModel):
    job_id: Optional[str] = None
    context_hash: Optional[str] = None
    cancel_all: bool = False
    reason: Optional[str] = "cancelled_by_client"


# --- Progress Tracker ---
class ProgressTracker:
    def __init__(self, total_lines, total_chars, callback_url, job_id, context_hash):
        self.total_lines = total_lines
        self.total_chars = total_chars
        self.completed_lines = 0
        self.completed_chars = 0
        self.start_time = time.time()
        self.callback_url = callback_url
        self.job_id = job_id
        self.context_hash = context_hash
        self.lock = asyncio.Lock()
        
        # For smoothing the ETA
        self.avg_chars_per_sec = None
        self.smoothing_factor = 0.2  # Weight for new data
        self.previous_callback = None

    async def update(self, filename, chars=0, error=None, status="running"):
        async with self.lock:
            self.completed_lines += 1
            
            elapsed_since_start = time.time() - self.start_time
            
            # If there was an error, we treat this line as "not rendered"
            # We subtract its chars from the total so it doesn't inflate throughput
            if error:
                self.total_chars = max(0, self.total_chars - chars)
            else:
                self.completed_chars += chars

            # Calculate current throughput
            if self.completed_chars > 0 and elapsed_since_start > 0:
                current_cps = self.completed_chars / elapsed_since_start
                
                # Apply smoothing
                if self.avg_chars_per_sec is None:
                    self.avg_chars_per_sec = current_cps
                else:
                    self.avg_chars_per_sec = (current_cps * self.smoothing_factor) + (self.avg_chars_per_sec * (1 - self.smoothing_factor))
                
                remaining_chars = max(0, self.total_chars - self.completed_chars)
                eta = remaining_chars / self.avg_chars_per_sec
            else:
                eta = 0

            effective_status = status
            if self.completed_lines >= self.total_lines and status == "running":
                effective_status = "completed"

            progress_data = {
                "job_id": self.job_id,
                "context_hash": self.context_hash,
                "completed": self.completed_lines,
                "total": self.total_lines,
                "completed_chars": self.completed_chars,
                "total_chars": self.total_chars,
                "percent": round((self.completed_lines / self.total_lines) * 100, 1) if self.total_lines > 0 else 100,
                "eta_seconds": round(eta, 1),
                "last_file": filename,
                "error": error is not None,
                "status": effective_status
            }

            print(
                f"[Progress] job={self.job_id} "
                f"{self.completed_lines}/{self.total_lines} lines ({progress_data['percent']}%) "
                f"ETA: {progress_data['eta_seconds']}s - {effective_status}"
            )

            if self.callback_url:
                task = asyncio.create_task(self._send_callback(progress_data, self.previous_callback))
                self.previous_callback = task
                callback_tasks.add(task)
                task.add_done_callback(callback_tasks.discard)

    async def _send_callback(self, data, previous=None):
        try:
            if previous:
                await previous
            async with callback_session.post(self.callback_url, json=data) as response:
                response.raise_for_status()
        except Exception as e:
            print(f"[Warning] Callback failed: {e}")


# --- Helpers ---
def clean_filename(crc: str) -> str:
    return re.sub(r'[^\w.-]', '_', crc) + ".wav"


def _deterministic_digit_from_name(name: str) -> int:
    """Hashes a character name to consistently return a digit 0-9."""
    if name is None:
        name = ""
    normalized = name.strip().lower()
    md5digest = hashlib.md5(normalized.encode('utf-8')).hexdigest()
    val = int(md5digest, 16)
    return val % 10


def _deterministic_index_from_name(name: str, size: int) -> int:
    if size <= 0:
        return 0
    if name is None:
        name = ""
    normalized = name.strip().lower()
    md5digest = hashlib.md5(normalized.encode('utf-8')).hexdigest()
    val = int(md5digest, 16)
    return val % size


def _normalize_voice_token(value: Optional[str]) -> str:
    return re.sub(r'\s+', '_', str(value or '').strip().lower())


def _natural_sort_key(value: str):
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r'(\d+)', value)]


def _extract_generic_profile_key_from_stem(stem: str) -> str:
    normalized = _normalize_voice_token(stem)
    if not normalized:
        return ""

    parts = [part for part in normalized.split('_') if part]
    while parts and parts[0].isdigit():
        parts.pop(0)

    if not parts:
        return ""
    if len(parts) == 1 and parts[0] == 'generic':
        return 'generic'
    if parts[-1] != 'generic':
        return ''

    profile_parts = parts[:-1]
    if not profile_parts:
        return 'generic'
    return _normalize_voice_token('_'.join(profile_parts))


def _find_generic_profile_candidates(search_dir: Optional[str], profile_key: str):
    if not search_dir:
        return []
    try:
        directory = os.path.normcase(os.path.realpath(search_dir))
        stamp = os.stat(directory)
        signature = (stamp.st_mtime_ns, stamp.st_ctime_ns)
        cached = voice_catalogue.get(directory)
        if cached and cached[0] == signature:
            voice_catalogue.move_to_end(directory)
            return cached[1].get(profile_key, [])
        profiles = {}
        with os.scandir(directory) as entries:
            for entry in entries:
                if not entry.is_file():
                    continue
                stem, ext = os.path.splitext(entry.name)
                if ext.lower() not in ['.wav', '.mp3', '.ogg']:
                    continue
                key = _extract_generic_profile_key_from_stem(stem)
                if key:
                    profiles.setdefault(key, []).append((entry.name, entry.path))
        for candidates in profiles.values():
            candidates.sort(key=lambda item: _natural_sort_key(item[0]))
        voice_catalogue[directory] = (signature, profiles)
        voice_catalogue.move_to_end(directory)
        while len(voice_catalogue) > 32:
            voice_catalogue.popitem(last=False)
        return profiles.get(profile_key, [])
    except OSError:
        return []


def resolve_voice_paths(
    character: str,
    gender: str,
    mood: str,
    project_voices_path: Optional[str] = None,
    generic_voice_profile: Optional[str] = None
):
    """
    Core Routing Logic: Handles Narrator, Exact Matches, semantic generic profile fallback, and legacy deterministic gender fallback.
    Returns: (voice_prompt_path, emo_audio_prompt_path, used_base_voice_name, is_fallback)
    """
    char_lower = character.lower()
    gender_lower = gender.lower() if gender else ""
    is_narrator = (gender_lower == "narrator") or (char_lower == "narrator")
    search_dirs = [project_voices_path, LOCAL_VOICES_DIR, VOICES_DIR]

    # 1. Handle Narrator
    if is_narrator:
        for ext in ['.wav', '.mp3', '.ogg']:
            temp_voice = f"narrator{ext}"
            temp_path = os.path.join(VOICES_DIR, temp_voice)
            if os.path.exists(temp_path):
                return temp_path, None, temp_voice, False

        # Fallback to male0 if narrator is missing
        for ext in ['.wav', '.mp3', '.ogg']:
            temp_voice = f"male0{ext}"
            temp_path = os.path.join(VOICES_DIR, temp_voice)
            if os.path.exists(temp_path):
                return temp_path, None, temp_voice, False

        raise RuntimeError("Neither narrator nor male0 found in voices directory.")

    # 2. Handle Exact Character Match
    # Check both Local and Global voices dirs, with case-insensitive fallback
    base_path = None
    search_names = [character, character.lower()]

    for d in search_dirs:
        if not d or not os.path.exists(d):
            continue
        for name in search_names:
            for ext in ['.wav', '.mp3', '.ogg']:
                temp_voice = f"{name}{ext}"
                temp_path = os.path.join(d, temp_voice)
                if os.path.exists(temp_path):
                    base_path = temp_path
                    base_voice = temp_voice
                    break
            if base_path:
                break
        if base_path:
            break

    is_fallback = False

    # 3. Handle Semantic Generic Profile Fallback
    requested_profile = _normalize_voice_token(generic_voice_profile)
    if not base_path and requested_profile:
        for d in search_dirs:
            candidates = _find_generic_profile_candidates(d, requested_profile)
            if not candidates:
                continue
            is_fallback = True
            index = _deterministic_index_from_name(character, len(candidates))
            base_voice, base_path = candidates[index]
            break

    # 4. Handle Legacy Gender Hash Fallback
    if not base_path:
        is_fallback = True
        safe_gender = gender_lower if gender_lower in ["male", "female"] else "male"
        digit = _deterministic_digit_from_name(character)
        base_voice = f"{safe_gender}{digit}.wav"
        base_path = os.path.join(VOICES_DIR, base_voice)

        if not os.path.exists(base_path):
            raise RuntimeError(f"Voice not found for '{character}' AND generic fallback '{base_voice}' is missing.")

    # 5. Handle Moods
    emo_path = None
    if mood and mood.lower() != "neutral":
        parent_dir = os.path.dirname(base_path)
        base_name_without_ext = os.path.splitext(os.path.basename(base_path))[0]

        for ext in ['.wav', '.mp3', '.ogg']:
            mood_filename = f"{base_name_without_ext}_{mood.lower()}{ext}"
            temp_emo_path = os.path.join(parent_dir, mood_filename)
            if os.path.exists(temp_emo_path):
                emo_path = temp_emo_path
                break
        else:
            # A project may provide emotion_happy.wav etc. as a delivery
            # reference shared by every character. The prefix reserves these
            # files from character-name routing.
            for d in search_dirs:
                if not d or not os.path.exists(d):
                    continue
                for ext in ['.wav', '.mp3', '.ogg']:
                    shared_filename = f"emotion_{mood.lower()}{ext}"
                    temp_emo_path = os.path.join(d, shared_filename)
                    if os.path.exists(temp_emo_path):
                        emo_path = temp_emo_path
                        break
                if emo_path:
                    break

            if not emo_path:
                print(f"[IndexTTS2] Mood requested: '{mood}', but neither '{mood_filename}' nor a shared 'emotion_{mood.lower()}' reference was found. Falling back to neutral.")

    return base_path, emo_path, base_voice, is_fallback


# --- Cleanup Task ---
async def cleanup_output_files():
    """Background task to delete old output files and stale job state."""
    while True:
        try:
            now = time.time()
            max_age_seconds = MAX_OUTPUT_AGE_MINUTES * 60

            if os.path.exists(OUTPUT_DIR):
                for filename in os.listdir(OUTPUT_DIR):
                    file_path = os.path.join(OUTPUT_DIR, filename)
                    if not os.path.isfile(file_path):
                        continue

                    file_age = now - os.path.getmtime(file_path)
                    if file_age > max_age_seconds:
                        try:
                            os.remove(file_path)
                            print(f"[Cleanup] Deleted old file: {filename} ({round(file_age / 60, 1)} min old)")
                        except Exception as e:
                            print(f"[Cleanup] Error deleting {filename}: {e}")

            await cleanup_job_registry()
        except Exception as e:
            print(f"[Cleanup] Error in cleanup loop: {e}")

        await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)


# --- FastAPI ---
app = FastAPI(title="IndexTTS2 API (Standalone)")


@app.on_event("startup")
async def startup_event():
    global inference_service, callback_session, cleanup_task
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.makedirs(VOICES_DIR, exist_ok=True)
    os.makedirs(LOCAL_VOICES_DIR, exist_ok=True)
    # Start the periodic cleanup task
    cleanup_task = asyncio.create_task(cleanup_output_files())
    callback_session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10))
    if inference_service is None:
        inference_service = InferenceService(default_worker_options())


@app.on_event("shutdown")
async def shutdown_event():
    if cleanup_task:
        cleanup_task.cancel()
        with suppress(asyncio.CancelledError):
            await cleanup_task
    if inference_service:
        await inference_service.close()
    if callback_tasks:
        await asyncio.gather(*list(callback_tasks), return_exceptions=True)
    if callback_session:
        await callback_session.close()


@app.post("/generate")
async def generate_batch_tts(request: TTSRequest):
    job_id = (request.job_id or "").strip() or f"tts_{uuid4().hex}"
    context_hash = (request.context_hash or "").strip() or None

    try:
        await register_or_refresh_job(job_id, context_hash, request.lease_ttl_seconds)
    except ValueError as e:
        return JSONResponse(status_code=409, content={"error": str(e)})

    print(f"\n[API] Received batch with {len(request.lines)} lines. job_id={job_id}")
    
    total_chars = sum(len(line.text) for line in request.lines)
    tracker = ProgressTracker(
        total_lines=len(request.lines),
        total_chars=total_chars,
        callback_url=request.callback_url,
        job_id=job_id,
        context_hash=context_hash
    )

    async def process_line(line: DialogueLine):
        line_started = time.perf_counter()
        output_filename = clean_filename(line.crc)
        output_path = os.path.join(OUTPUT_DIR, output_filename)

        result_payload = {
            "job_id": job_id,
            "context_hash": context_hash,
            "index": line.index,
            "crc": line.crc,
            "filename": output_filename,
            "engine": "indextts2"
        }

        error_msg = None
        status = "running"

        cancelled, cancel_reason = await get_job_cancellation_state(job_id)
        if cancelled:
            error_msg = f"Cancelled: {cancel_reason}"
            status = "cancelled"
            result_payload["error"] = error_msg
            await tracker.update(output_filename, chars=len(line.text), error=error_msg, status=status)
            return result_payload

        try:
            # Execute the smart routing logic
            resolve_started = time.perf_counter()
            voice_prompt_path, emo_audio_prompt, used_voice, is_fallback = resolve_voice_paths(
                character=line.character,
                gender=line.gender,
                mood=line.mood,
                project_voices_path=request.project_voices_path,
                generic_voice_profile=line.generic_voice_profile
            )
            resolution_seconds = time.perf_counter() - resolve_started

            result_payload["used_voice"] = used_voice
            result_payload["is_fallback"] = is_fallback
            if emo_audio_prompt:
                result_payload["used_mood"] = line.mood

            # Console logging formatting
            mood_str = f" (Mood: {line.mood})" if emo_audio_prompt else ""
            fallback_str = "[FALLBACK]" if is_fallback else "[EXACT MATCH]"
            if line.character.lower() == "narrator" or (line.gender and line.gender.lower() == "narrator"):
                fallback_str = "[NARRATOR]"

            print(f"[IndexTTS2] {fallback_str} '{line.crc}' routing to {used_voice}{mood_str}")

            metrics = await inference_service.infer(
                line.text, voice_prompt_path, output_path, emo_audio_prompt, job_id=job_id
            )
            if metrics.get('error'):
                raise RuntimeError(metrics['error'])
            # Cancellation during an in-flight call must not publish stale audio.
            cancelled, cancel_reason = await get_job_cancellation_state(job_id)
            if cancelled:
                raise RuntimeError(f'Cancelled: {cancel_reason}')
            metrics['resolution_seconds'] = round(resolution_seconds, 3)
            metrics['line_seconds'] = round(time.perf_counter() - line_started, 3)
            result_payload['timings'] = metrics
            print(f"[Timing] {line.crc}: {metrics}", flush=True)

        except Exception as e:
            error_msg = str(e)
            result_payload["error"] = error_msg
            if error_msg.lower().startswith("cancelled"):
                status = "cancelled"
            print(f"[Error] {error_msg}")

        await tracker.update(output_filename, chars=len(line.text), error=error_msg, status=status)
        return result_payload

    # Preserve supplied story order. Conditioning reuse does not require moving
    # later lines ahead of the next clip the player needs.
    inference_service.begin_batch()
    try:
        task_results = []
        for line in request.lines:
            task_results.append(await process_line(line))
    finally:
        inference_service.end_batch()
        await mark_job_finished(job_id)

    results = [r for r in task_results if "error" not in r]
    errors = [r for r in task_results if "error" in r]

    cancelled_errors = [r for r in errors if str(r.get("error", "")).lower().startswith("cancelled")]
    overall_status = "cancelled" if cancelled_errors else "completed"
    if cancelled_errors and results:
        overall_status = "partial_cancelled"

    return JSONResponse(content={
        "job_id": job_id,
        "context_hash": context_hash,
        "status": overall_status,
        "results": results,
        "errors": errors
    })


@app.post("/lease")
async def renew_tts_job_lease(request: LeaseRequest):
    try:
        entry = await renew_job_lease(request.job_id, request.context_hash, request.lease_ttl_seconds)
    except ValueError as e:
        return JSONResponse(status_code=409, content={"error": str(e)})

    if not entry:
        return JSONResponse(status_code=404, content={"error": "job not found"})

    return JSONResponse(content={
        "success": True,
        "job_id": request.job_id,
        "context_hash": entry.get("context_hash"),
        "expires_at": entry.get("expires_at"),
        "cancelled": entry.get("cancelled", False)
    })


@app.post("/cancel")
async def cancel_tts_job(request: CancelRequest):
    if not request.cancel_all and not request.job_id and not request.context_hash:
        return JSONResponse(
            status_code=400,
            content={"error": "Provide at least one of: job_id, context_hash, or cancel_all=true"}
        )

    cancelled = await cancel_jobs(
        job_id=request.job_id,
        context_hash=request.context_hash,
        cancel_all=request.cancel_all,
        reason=(request.reason or "cancelled_by_client")
    )

    return JSONResponse(content={"success": True, "cancelled": cancelled})


@app.get("/audio/{filename}")
async def get_audio(filename: str):
    if ".." in filename or "/" in filename or "\\" in filename:
        return JSONResponse(status_code=400, content={"error": "Invalid filename."})

    file_path = os.path.join(OUTPUT_DIR, filename)

    if os.path.exists(file_path):
        return FileResponse(file_path, media_type="audio/wav")

    return JSONResponse(status_code=404, content={"error": "File not found"})


def default_worker_options():
    return dict(model_dir=CHECKPOINTS_DIR, model_version='auto', language='EN',
                cuda_kernel=True, use_accel=False, use_torch_compile=False,
                cache_entries=32, cache_mb=256,
                duration_factor=0.90, emotion_alpha=0.75)


def create_argument_parser():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', type=str, default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--parallel', type=int, choices=[1], default=1,
                        help='One worker preserves ordering and protects mutable model state.')
    parser.add_argument('--model-version', choices=['auto', '2', '2.5'], default='auto')
    parser.add_argument('--model-dir', default=CHECKPOINTS_DIR)
    parser.add_argument('--language', choices=['EN', 'ZH', 'JA', 'ES', 'AR', 'ZHEN'], default='EN')
    parser.add_argument('--shared-dir', help='Shared TTS folder containing voices/ and output/.')
    parser.add_argument('--idle-unload-seconds', type=float, default=5,
                        help='Stop the GPU worker after this idle period; 0 immediately, -1 keeps it loaded.')
    parser.add_argument('--reference-cache-entries', type=int, default=32)
    parser.add_argument('--reference-cache-mb', type=int, default=256)
    parser.add_argument('--duration-factor', type=float, default=0.90,
                        help='IndexTTS 2.5 duration multiplier; below 1.0 speaks faster.')
    parser.add_argument('--emotion-alpha', type=float, default=0.75,
                        help='Emotion reference strength, from 0.0 to 1.0.')
    parser.add_argument('--accel', action='store_true', help='Opt in to upstream GPT acceleration.')
    parser.add_argument('--torch-compile', action='store_true', help='Opt in to upstream S2Mel compilation.')
    parser.add_argument('--no-cuda-kernel', action='store_true')
    return parser


# --- Main ---
if __name__ == "__main__":
    multiprocessing.freeze_support()
    parser = create_argument_parser()
    args = parser.parse_args()
    if args.reference_cache_entries < 0 or args.reference_cache_mb < 0:
        parser.error('Reference cache limits must be non-negative.')
    if not 0.5 <= args.duration_factor <= 2.0:
        parser.error('--duration-factor must be between 0.5 and 2.0.')
    if not 0.0 <= args.emotion_alpha <= 1.0:
        parser.error('--emotion-alpha must be between 0.0 and 1.0.')
    if not math.isfinite(args.idle_unload_seconds) or (args.idle_unload_seconds < 0 and args.idle_unload_seconds != -1):
        parser.error('--idle-unload-seconds must be non-negative or -1.')
    if args.shared_dir:
        BASE_DIR = os.path.abspath(args.shared_dir)
    else:
        # Accept both TTS/IndexTTS2/index-tts and TTS/IndexTTS25 layouts.
        parent_dir = os.path.dirname(SCRIPT_DIR)
        if os.path.isdir(os.path.join(parent_dir, 'voices')):
            BASE_DIR = parent_dir
    VOICES_DIR = os.path.join(BASE_DIR, 'voices')
    OUTPUT_DIR = os.path.join(BASE_DIR, 'output')
    options = default_worker_options()
    options.update(model_dir=os.path.abspath(args.model_dir), model_version=args.model_version,
                   language=args.language, cuda_kernel=not args.no_cuda_kernel,
                   use_accel=args.accel, use_torch_compile=args.torch_compile,
                   cache_entries=args.reference_cache_entries, cache_mb=args.reference_cache_mb,
                   duration_factor=args.duration_factor, emotion_alpha=args.emotion_alpha)
    if not os.path.isfile(os.path.join(options['model_dir'], 'config.yaml')):
        parser.error('Model config.yaml not found. Copy the bridge into IndexTTS or set --model-dir.')
    inference_service = InferenceService(options, idle_seconds=args.idle_unload_seconds)

    print("--- IndexTTS2 API Standalone ---")
    print(f"Port: {args.port}")
    print(f"Model: {args.model_version}; loaded on first request")
    print(f"Idle GPU release: {args.idle_unload_seconds}s (-1 means disabled)")
    print(f"Reference cache: {args.reference_cache_entries} entries / {args.reference_cache_mb} MiB")
    print(f"Speech timing: duration factor {args.duration_factor:.2f}; emotion alpha {args.emotion_alpha:.2f}")

    uvicorn.run(app, host=args.host, port=args.port)
