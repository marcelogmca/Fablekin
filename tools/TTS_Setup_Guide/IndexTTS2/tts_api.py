import os
import sys
import argparse
import re
import asyncio
import hashlib
import time
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
BASE_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))  # Root: G:\Locker\TTS

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

# --- Import IndexTTS2 ---
try:
    from indextts.infer_v2 import IndexTTS2
    INDEX_AVAILABLE = True
except ImportError as e:
    print(f"Error importing IndexTTS2: {e}")
    INDEX_AVAILABLE = False

# --- Global Objects ---
model = None
tts_semaphore = None
jobs = {}
jobs_lock = asyncio.Lock()


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
                asyncio.create_task(self._send_callback(progress_data))

    async def _send_callback(self, data):
        try:
            async with aiohttp.ClientSession() as session:
                await session.post(self.callback_url, json=data)
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
    if not search_dir or not os.path.exists(search_dir):
        return []

    candidates = []
    try:
        filenames = os.listdir(search_dir)
    except Exception:
        return []

    for filename in filenames:
        full_path = os.path.join(search_dir, filename)
        if not os.path.isfile(full_path):
            continue
        ext = os.path.splitext(filename)[1].lower()
        if ext not in ['.wav', '.mp3', '.ogg']:
            continue

        stem = os.path.splitext(filename)[0]
        key = _extract_generic_profile_key_from_stem(stem)
        if key == profile_key:
            candidates.append((filename, full_path))

    candidates.sort(key=lambda item: _natural_sort_key(item[0]))
    return candidates


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
            print(f"[IndexTTS2] Mood requested: '{mood}', but '{mood_filename}' not found in {parent_dir}. Falling back to neutral.")

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


# --- Inference Worker ---
def run_indextts_inference(text, voice_prompt_path, output_path, emo_audio_prompt=None):
    global model

    if not model:
        raise RuntimeError("IndexTTS2 not loaded.")

    model.infer(
        spk_audio_prompt=voice_prompt_path,
        text=text,
        output_path=output_path,
        emo_audio_prompt=emo_audio_prompt,
        emo_alpha=0.85,
        use_random=False,
        verbose=False
    )


# --- FastAPI ---
app = FastAPI(title="IndexTTS2 API (Standalone)")


@app.on_event("startup")
async def startup_event():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.makedirs(VOICES_DIR, exist_ok=True)
    os.makedirs(LOCAL_VOICES_DIR, exist_ok=True)
    # Start the periodic cleanup task
    asyncio.create_task(cleanup_output_files())


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
            if not INDEX_AVAILABLE:
                raise RuntimeError("IndexTTS2 not available")

            # Execute the smart routing logic
            voice_prompt_path, emo_audio_prompt, used_voice, is_fallback = resolve_voice_paths(
                character=line.character,
                gender=line.gender,
                mood=line.mood,
                project_voices_path=request.project_voices_path,
                generic_voice_profile=line.generic_voice_profile
            )

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

            async with tts_semaphore:
                cancelled, cancel_reason = await get_job_cancellation_state(job_id)
                if cancelled:
                    error_msg = f"Cancelled: {cancel_reason}"
                    status = "cancelled"
                else:
                    loop = asyncio.get_running_loop()
                    await loop.run_in_executor(
                        None,
                        run_indextts_inference,
                        line.text,
                        voice_prompt_path,
                        output_path,
                        emo_audio_prompt
                    )

        except Exception as e:
            error_msg = str(e)
            result_payload["error"] = error_msg
            if error_msg.lower().startswith("cancelled"):
                status = "cancelled"
            print(f"[Error] {error_msg}")

        await tracker.update(output_filename, chars=len(line.text), error=error_msg, status=status)
        return result_payload

    tasks = [process_line(line) for line in request.lines]
    task_results = await asyncio.gather(*tasks)

    results = [r for r in task_results if "error" not in r]
    errors = [r for r in task_results if "error" in r]

    cancelled_errors = [r for r in errors if str(r.get("error", "")).lower().startswith("cancelled")]
    overall_status = "cancelled" if cancelled_errors else "completed"
    if cancelled_errors and results:
        overall_status = "partial_cancelled"

    await mark_job_finished(job_id)

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


# --- Main ---
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', type=str, default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--parallel', type=int, default=1)
    args = parser.parse_args()

    tts_semaphore = asyncio.Semaphore(args.parallel)

    if INDEX_AVAILABLE:
        print("Initializing IndexTTS2...")
        try:
            model = IndexTTS2(
                cfg_path=os.path.join(CHECKPOINTS_DIR, "config.yaml"),
                model_dir=CHECKPOINTS_DIR,
                use_fp16=True,
                use_cuda_kernel=True,
                use_deepspeed=False
            )
            print("IndexTTS2 loaded successfully.")
        except Exception as e:
            print(f"FATAL: Failed to load IndexTTS2: {e}")
            sys.exit(1)
    else:
        print("FATAL: IndexTTS2 library not found.")
        sys.exit(1)

    print("--- IndexTTS2 API Standalone ---")
    print(f"Port: {args.port}")
    print(f"Parallel Jobs: {args.parallel}")

    uvicorn.run(app, host=args.host, port=args.port)
