"""Wrapper regression tests: python -m unittest -v test_tts_api.py (no GPU needed)."""
import asyncio
import json
import os
from pathlib import Path
import tempfile
import time
import sys
from contextlib import nullcontext
from types import SimpleNamespace, ModuleType
import unittest
from unittest.mock import AsyncMock, patch

import tts_api as api


class Tensor:
    device = 'cuda:0'

    def __init__(self, value, size=8):
        self.value, self.size = value, size

    def untyped_storage(self):
        return self

    def data_ptr(self):
        return id(self)

    def nbytes(self):
        return self.size


class Model:
    """Exercise the real adapter against upstream's single-entry cache contract."""

    def __init__(self):
        api.ReferenceCache.clear_model_slots(self)
        self.speakers, self.emotions, self.lines = [], [], []
        self.fail = False

    def infer(self, **kwargs):
        speaker = kwargs['spk_audio_prompt']
        emotion = kwargs['emo_audio_prompt'] or speaker
        if self.cache_spk_cond is None or self.cache_spk_audio_prompt != speaker:
            self.speakers.append(speaker)
            for field in api.ReferenceCache.SPEAKER_FIELDS:
                setattr(self, field, Tensor(speaker + field))
            self.cache_spk_audio_prompt = speaker
        if self.cache_emo_cond is None or self.cache_emo_audio_prompt != emotion:
            self.emotions.append(emotion)
            self.cache_emo_cond = Tensor(emotion)
            self.cache_emo_audio_prompt = emotion
        self.lines.append((kwargs['text'], self.cache_spk_cond.value, self.cache_emo_cond.value))
        self.last_kwargs = kwargs
        Path(kwargs['output_path']).write_bytes(b'RIFF' + b'x' * 100)
        if self.fail:
            raise RuntimeError('Synthesis failed')


def fake_process_infer(options, text, voice, output, emotion=None):
    """Real spawned process, but no model weights or CUDA required."""
    time.sleep(options.get('delay', 0))
    return {'pid': os.getpid(), 'text': text}


class ReferenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ['john', 'bianca', 'timmy', 'john_happy', 'john_nervous', 'timmy_happy']:
            (self.root / f'{name}.wav').write_bytes(b'reference')
        self.runtime = api.InferenceRuntime.__new__(api.InferenceRuntime)
        self.runtime.model = Model()
        self.runtime.torch = SimpleNamespace(inference_mode=nullcontext)
        self.runtime.version = '2.5'
        self.runtime.language = 'EN'
        self.runtime.cache = api.ReferenceCache()

    def render(self, index, voice='john', mood='john_happy'):
        return self.runtime.infer(str(index), str(self.root / f'{voice}.wav'),
                                  str(self.root / f'out{index}.wav'),
                                  str(self.root / f'{mood}.wav') if mood else None)

    def test_alternating_speakers_and_moods_preserve_order_and_reuse(self):
        results = [self.render(1), self.render(2, 'bianca', None), self.render(3),
                   self.render(4, 'john', 'john_nervous'), self.render(5, 'timmy', 'timmy_happy')]
        self.assertEqual(len(self.runtime.model.speakers), 3)
        self.assertEqual(len(self.runtime.model.emotions), 4)
        self.assertEqual([line[0] for line in self.runtime.model.lines], ['1', '2', '3', '4', '5'])
        self.assertTrue(results[2]['speaker_cache_hit'])
        self.assertTrue(results[2]['emotion_cache_hit'])
        self.assertTrue(results[3]['speaker_cache_hit'])
        self.assertFalse(results[3]['emotion_cache_hit'])
        self.assertIn('john.wav', self.runtime.model.lines[2][1])
        self.assertIn('john_happy.wav', self.runtime.model.lines[2][2])
        self.assertIsNone(self.runtime.model.cache_spk_cond)
        self.assertEqual(self.runtime.model.last_kwargs['lang'], 'EN')

    def test_reference_replaced_in_place_is_invalidated(self):
        self.render(1)
        reference = self.root / 'john.wav'
        stamp = reference.stat()
        os.utime(reference, ns=(stamp.st_atime_ns, stamp.st_mtime_ns + 1_000_000_000))
        result = self.render(2)
        self.assertFalse(result['speaker_cache_hit'])
        self.assertTrue(result['emotion_cache_hit'])
        self.assertEqual(len(self.runtime.model.speakers), 2)

    def test_lru_eviction_byte_limit_and_disabled_cache(self):
        cache = api.ReferenceCache(max_entries=2, max_bytes=16)
        keys = [('emotion', str(i), 0, 1) for i in range(4)]
        for key in keys[:2]:
            cache.put(key, (Tensor(key),))
        cache.get(keys[0])
        cache.put(keys[2], (Tensor('third'),))
        self.assertIsNone(cache.get(keys[1]))
        self.assertIsNotNone(cache.get(keys[0]))
        self.assertEqual(cache.bytes_used, 16)
        cache.put(keys[3], (Tensor('oversize', 32),))
        self.assertIsNone(cache.get(keys[3]))
        self.runtime.cache = api.ReferenceCache(max_entries=0)
        self.render(1)
        self.assertFalse(self.render(2)['speaker_cache_hit'])
        self.assertEqual(self.runtime.cache.bytes_used, 0)

    def test_failure_leaves_existing_audio_intact_and_clears_model_slots(self):
        output = self.root / 'out1.wav'
        output.write_bytes(b'previous audio')
        self.runtime.model.fail = True
        with self.assertRaisesRegex(RuntimeError, 'Synthesis failed'):
            self.render(1)
        self.assertEqual(output.read_bytes(), b'previous audio')
        self.assertFalse(list(self.root.glob('*.tmp.wav')))
        self.assertIsNone(self.runtime.model.cache_emo_cond)
        self.assertEqual(self.runtime.cache.bytes_used, 0)

    def test_v2_omits_language_and_neutral_uses_speaker_reference(self):
        self.runtime.version = '2'
        self.render(1, mood=None)
        self.assertNotIn('lang', self.runtime.model.last_kwargs)
        self.assertIsNone(self.runtime.model.last_kwargs['emo_audio_prompt'])
        self.assertTrue(self.render(2, mood=None)['emotion_cache_hit'])

    def test_generic_catalogue_refreshes_after_directory_change(self):
        api.voice_catalogue.clear()
        (self.root / '1_old_man_generic.wav').write_bytes(b'voice')
        first = api._find_generic_profile_candidates(str(self.root), 'old_man')
        with patch.object(api.os, 'scandir', side_effect=AssertionError('unexpected rescan')):
            self.assertEqual(api._find_generic_profile_candidates(str(self.root), 'old_man'), first)
        (self.root / '2_old_man_generic.wav').write_bytes(b'voice')
        stamp = self.root.stat()
        os.utime(self.root, ns=(stamp.st_atime_ns, stamp.st_mtime_ns + 1_000_000_000))
        self.assertEqual(len(api._find_generic_profile_candidates(str(self.root), 'old_man')), 2)

    def test_shared_emotion_reference_applies_to_any_character(self):
        (self.root / 'bianca.wav').write_bytes(b'voice')
        (self.root / 'emotion_happy.wav').write_bytes(b'emotion')
        base, emotion, voice_name, is_fallback = api.resolve_voice_paths(
            'bianca', 'female', 'happy', str(self.root)
        )
        self.assertEqual(Path(base).name, 'bianca.wav')
        self.assertEqual(Path(emotion).name, 'emotion_happy.wav')
        self.assertEqual(voice_name, 'bianca.wav')
        self.assertFalse(is_fallback)

    def test_model_config_selects_v25_bf16_without_optional_acceleration(self):
        (self.root / 'config.yaml').write_text('version: 2.5\n', encoding='utf-8')
        module = ModuleType('indextts.infer_v2_5')
        captured = {}

        class IndexTTS2(Model):
            def __init__(self, cfg_path, model_dir, use_bf16, use_cuda_kernel,
                         use_deepspeed, use_qwen_emo=True):
                super().__init__()
                captured.update(bf16=use_bf16, qwen=use_qwen_emo, model_dir=model_dir)

        module.IndexTTS2 = IndexTTS2
        options = api.default_worker_options()
        options['model_dir'] = str(self.root)
        with patch.dict(sys.modules, {'indextts.infer_v2_5': module, 'torch': SimpleNamespace()}):
            runtime = api.InferenceRuntime(options)
        self.assertEqual(runtime.version, '2.5')
        self.assertEqual(captured, dict(bf16=True, qwen=False, model_dir=str(self.root)))


class LifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        api.jobs.clear()
        api.jobs_lock = asyncio.Lock()

    async def test_worker_exits_when_idle_and_reloads_on_next_batch(self):
        service = api.InferenceService({}, idle_seconds=0)
        self.addAsyncCleanup(service.close)
        with patch.object(api, 'run_indextts_inference', fake_process_infer):
            service.begin_batch()
            first = await service.infer('first', '', '')
            second = await service.infer('second', '', '')
            self.assertEqual(first['pid'], second['pid'])
            process = next(iter(service.pool._processes.values()))
            service.end_batch()
            await service.idle_task
            self.assertFalse(process.is_alive())
            self.assertIsNone(service.pool)
            service.begin_batch()
            await service.infer('third', '', '')
            replacement = next(iter(service.pool._processes.values()))
            self.assertIsNot(process, replacement)
            service.end_batch()

    async def test_pending_batch_prevents_unload_and_new_batch_cancels_idle_timer(self):
        service = api.InferenceService({}, idle_seconds=0.05)
        self.addAsyncCleanup(service.close)
        with patch.object(api, 'run_indextts_inference', fake_process_infer):
            service.begin_batch()
            original = await service.infer('first', '', '')
            service.begin_batch()
            service.end_batch()
            self.assertIsNone(service.idle_task)
            service.end_batch()
            service.begin_batch()
            await asyncio.sleep(0.08)
            next_result = await service.infer('next', '', '')
            self.assertEqual(original['pid'], next_result['pid'])
            service.end_batch()

    async def test_cancellation_waits_for_inflight_worker_before_unload(self):
        service = api.InferenceService({'delay': 0.15}, idle_seconds=0)
        self.addAsyncCleanup(service.close)
        with patch.object(api, 'run_indextts_inference', fake_process_infer):
            service.begin_batch()
            task = asyncio.create_task(service.infer('first', '', ''))
            await asyncio.sleep(0.02)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            self.assertFalse(service.lock.locked())
            service.end_batch()
            await service.idle_task
            self.assertIsNone(service.pool)

    async def test_expired_queued_job_never_starts_worker(self):
        service = api.InferenceService({})
        self.addAsyncCleanup(service.close)
        await api.register_or_refresh_job('expired', None, 20)
        async with service.lock:
            task = asyncio.create_task(service.infer('first', '', '', job_id='expired'))
            await asyncio.sleep(0)
            api.jobs['expired']['expires_at'] = 0
        result = await task
        self.assertEqual(result['error'], 'Cancelled: lease_expired')
        self.assertIsNone(service.pool)

    async def test_idle_unload_can_be_disabled(self):
        service = api.InferenceService({}, idle_seconds=-1)
        self.addAsyncCleanup(service.close)
        with patch.object(api, 'run_indextts_inference', fake_process_infer):
            service.begin_batch()
            await service.infer('first', '', '')
            service.end_batch()
            self.assertIsNone(service.idle_task)
            self.assertIsNotNone(service.pool)

    async def test_cancel_during_generation_is_not_reported_as_success(self):
        async def infer(*args, job_id=None):
            await api.cancel_jobs(job_id, None, False, 'viewer_changed')
            return {'speaker_cache_hit': False}

        service = SimpleNamespace(begin_batch=lambda: None, end_batch=lambda: None, infer=infer)
        line = api.DialogueLine(index=1, character='John', text='Hello', originaltext='Hello', crc='1')
        with patch.object(api, 'inference_service', service), \
             patch.object(api, 'resolve_voice_paths', return_value=('voice.wav', None, 'voice.wav', False)), \
             patch.object(api.ProgressTracker, 'update', new_callable=AsyncMock):
            response = await api.generate_batch_tts(api.TTSRequest(lines=[line], job_id='cancel_during'))
        body = json.loads(response.body)
        self.assertEqual(body['results'], [])
        self.assertEqual(body['status'], 'cancelled')
        self.assertEqual(body['errors'][0]['error'], 'Cancelled: viewer_changed')

    async def test_endpoint_order_callbacks_and_cancellation_results(self):
        service = SimpleNamespace(begin_batch=lambda: None, end_batch=lambda: None, infer=AsyncMock())
        service.infer.side_effect = [dict(speaker_cache_hit=False), {'error': 'Cancelled: test'}]
        lines = [api.DialogueLine(index=i, character='John', text=str(i), originaltext=str(i), crc=str(i))
                 for i in [2, 1]]
        with patch.object(api, 'inference_service', service), \
             patch.object(api, 'resolve_voice_paths', return_value=('voice.wav', None, 'voice.wav', False)), \
             patch.object(api.ProgressTracker, 'update', new_callable=AsyncMock) as progress:
            response = await api.generate_batch_tts(api.TTSRequest(lines=lines, job_id='batch'))
        body = json.loads(response.body)
        self.assertEqual([call.args[0] for call in service.infer.await_args_list], ['2', '1'])
        self.assertEqual(body['status'], 'partial_cancelled')
        self.assertEqual(body['results'][0]['index'], 2)
        self.assertEqual(body['errors'][0]['error'], 'Cancelled: test')
        self.assertEqual(progress.await_count, 2)
        self.assertTrue(api.jobs['batch']['finished'])

    async def test_shared_callback_session_preserves_per_job_completion_order(self):
        sent = []

        class Response:
            def __init__(self, value):
                self.value = value

            async def __aenter__(self):
                if self.value == 1:
                    await asyncio.sleep(0.02)
                sent.append(self.value)
                return self

            async def __aexit__(self, *args):
                pass

            def raise_for_status(self):
                pass

        session = SimpleNamespace(post=lambda url, json: Response(json['completed']))
        tracker = api.ProgressTracker(2, 2, 'http://callback', 'job', None)
        with patch.object(api, 'callback_session', session):
            await tracker.update('first.wav', chars=1)
            await tracker.update('second.wav', chars=1)
            await tracker.previous_callback
        self.assertEqual(sent, [1, 2])


if __name__ == '__main__':
    unittest.main()
