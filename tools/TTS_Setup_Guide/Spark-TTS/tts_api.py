import os
import sys
import argparse
import re
import asyncio
import hashlib
import time
from uuid import uuid4
import uvicorn
import torch
import soundfile as sf
import aiohttp
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from typing import List, Optional

# --- Directory Configuration ---
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)  # Root: G:\Locker\TTS

OUTPUT_DIR = os.path.join(BASE_DIR, "output")
VOICES_DIR = os.path.join(BASE_DIR, "voices")
LOCAL_VOICES_DIR = os.path.join(SCRIPT_DIR, "voices")
MODELS_DIR = os.path.join(SCRIPT_DIR, "pretrained_models/Spark-TTS-0.5B")

# --- Cleanup Configuration ---
MAX_OUTPUT_AGE_MINUTES = 30  # Files older than this will be deleted
CLEANUP_INTERVAL_SECONDS = 300  # How often to run the cleanup check (5 mins)

# --- Job Lease/Cancellation Configuration ---
DEFAULT_LEASE_TTL_SECONDS = 20
MIN_LEASE_TTL_SECONDS = 5
MAX_LEASE_TTL_SECONDS = 300
JOB_RETENTION_SECONDS = 300

# Add current dir to path for imports (to find cli.SparkTTS)
if SCRIPT_DIR not in sys.path:
    sys.path.append(SCRIPT_DIR)

# --- Import SparkTTS ---
try:
    from cli.SparkTTS import SparkTTS
    SPARK_AVAILABLE = True
except ImportError as e:
    print(f"Error importing SparkTTS: {e}")
    SPARK_AVAILABLE = False

# --- Global Objects ---
model = None
spark_semaphore = None
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
    mood: Optional[str] = None
    generic_voice_profile: Optional[str] = Field(None, description="Optional semantic generic voice profile key (e.g., 'old_man', 'monster').")


class TTSRequest(BaseModel):
    lines: List[DialogueLine]
    project_voices_path: Optional[str] = None
    callback_url: Optional[str] = Field(None, description="Node.js endpoint to hit with progress updates")
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
            print(f"[Warning] Failed to send progress: {e}")


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


# --- Helper Functions ---
def clean_filename(crc: str) -> str:
    return re.sub(r'[^\w.-]', '_', crc) + ".wav"


def _deterministic_digit_from_name(name: str) -> int:
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
    Tiered Priority: Project Voices > Local API Voices > Global Voices.
    Supports .wav, .mp3, .ogg.
    Moods are supported by searching for [Character]_[Mood].[ext].
    """
    char_lower = character.lower()
    gender_lower = gender.lower() if gender else "male"
    is_narrator = (gender_lower == "narrator") or (char_lower == "narrator")
    search_dirs = [project_voices_path, LOCAL_VOICES_DIR, VOICES_DIR]

    # 1. Narrator Special Case
    if is_narrator:
        for ext in ['.wav', '.mp3', '.ogg']:
            p = os.path.join(VOICES_DIR, f"narrator{ext}")
            if os.path.exists(p):
                return p, f"narrator{ext}"
        # Fallback to male0
        for ext in ['.wav', '.mp3', '.ogg']:
            p = os.path.join(VOICES_DIR, f"male0{ext}")
            if os.path.exists(p):
                return p, f"male0{ext}"
        raise RuntimeError("Narrator voices missing.")

    # 2. Main Priority Search
    base_path = None
    base_voice = None
    search_names = [character, character.lower()]

    for d in search_dirs:
        if not d or not os.path.exists(d):
            continue
        for name in search_names:
            for ext in ['.wav', '.mp3', '.ogg']:
                p = os.path.join(d, f"{name}{ext}")
                if os.path.exists(p):
                    base_path = p
                    base_voice = f"{name}{ext}"
                    break
            if base_path:
                break
        if base_path:
            break

    # 3. Semantic Generic Profile Fallback
    requested_profile = _normalize_voice_token(generic_voice_profile)
    if not base_path and requested_profile:
        for d in search_dirs:
            candidates = _find_generic_profile_candidates(d, requested_profile)
            if not candidates:
                continue
            index = _deterministic_index_from_name(character, len(candidates))
            base_voice, base_path = candidates[index]
            break

    # 4. Deterministic Hashed Fallback
    if not base_path:
        safe_gender = gender_lower if gender_lower in ["male", "female"] else "male"
        digit = _deterministic_digit_from_name(character)
        for ext in ['.wav', '.mp3', '.ogg']:
            p = os.path.join(VOICES_DIR, f"{safe_gender}{digit}{ext}")
            if os.path.exists(p):
                base_path = p
                base_voice = f"{safe_gender}{digit}{ext}"
                break

    if not base_path:
        raise RuntimeError(f"No voice file found for '{character}' or fallback.")

    # 5. Mood Refinement
    if mood and mood.lower() != "neutral":
        parent_dir = os.path.dirname(base_path)
        name_no_ext = os.path.splitext(os.path.basename(base_path))[0]
        for ext in ['.wav', '.mp3', '.ogg']:
            mood_p = os.path.join(parent_dir, f"{name_no_ext}_{mood.lower()}{ext}")
            if os.path.exists(mood_p):
                return mood_p, f"{name_no_ext}_{mood.lower()}{ext}"

    return base_path, base_voice


# --- Inference Worker ---
def run_spark_inference(text_to_process, voice_prompt_path, output_path):
    global model
    if not model:
        raise RuntimeError("Spark model not loaded.")

    segmentation_threshold = 150
    words = text_to_process.split()
    if len(words) > segmentation_threshold:
        inputs = [' '.join(words[i:i + segmentation_threshold]) for i in range(0, len(words), segmentation_threshold)]
    else:
        inputs = text_to_process

    try:
        with torch.no_grad():
            wav = model.inference(inputs, prompt_speech_path=voice_prompt_path)
        sf.write(output_path, wav, samplerate=16000)
    except Exception as e:
        raise RuntimeError(f"Spark Inference failed: {str(e)}")


# --- FastAPI Application ---
app = FastAPI(title="Spark-TTS API (Standalone)")


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
            "engine": "spark"
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
            if not SPARK_AVAILABLE:
                raise RuntimeError("SparkTTS not loaded")

            # Resolved Voice Logic
            voice_prompt_path, used_voice_file = resolve_voice_paths(
                character=line.character,
                gender=line.gender,
                mood=line.mood,
                project_voices_path=request.project_voices_path,
                generic_voice_profile=line.generic_voice_profile
            )

            print(f"[Spark] Scheduling '{line.crc}' (Voice: {used_voice_file})")

            async with spark_semaphore:
                cancelled, cancel_reason = await get_job_cancellation_state(job_id)
                if cancelled:
                    error_msg = f"Cancelled: {cancel_reason}"
                    status = "cancelled"
                else:
                    loop = asyncio.get_running_loop()
                    await loop.run_in_executor(None, run_spark_inference, line.text, voice_prompt_path, output_path)
                    result_payload["used_voice"] = used_voice_file

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

    spark_semaphore = asyncio.Semaphore(args.parallel)

    if SPARK_AVAILABLE:
        print(f"Status: Initializing Spark-TTS model from {MODELS_DIR}...")
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        try:
            model = SparkTTS(MODELS_DIR, device=device)
            print(f"Status: Spark loaded on {device.type.upper()}.")
        except Exception as e:
            print(f"FATAL: Failed to load Spark model: {e}")
            sys.exit(1)
    else:
        print("FATAL: SparkTTS library not found.")
        sys.exit(1)

    print("--- Spark-TTS API Standalone ---")
    print(f"Port: {args.port}")
    print(f"Parallel Jobs: {args.parallel}")
    uvicorn.run(app, host=args.host, port=args.port)
