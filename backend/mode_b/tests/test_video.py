"""Video validation, frame extraction, blur and duplicate filtering, keyframe selection (synthetic videos)."""
import json

import pytest

from mode_b import video
from mode_b.api import sniff_container
from mode_b.settings import ProcessingSettings


def test_container_is_recognised_from_the_bytes_not_the_name(tmp_video):
    mp4 = tmp_video(n=60, step=6).read_bytes()[:64]
    assert sniff_container(mp4) == "mp4"
    assert sniff_container(b"\x1a\x45\xdf\xa3" + b"\0" * 60) == "webm"
    assert sniff_container(b"RIFF\0\0\0\0AVI LIST" + b"\0" * 48) == "avi"
    assert sniff_container(b"\x89PNG\r\n\x1a\n" + b"\0" * 56) is None
    assert sniff_container(b"#!/bin/sh\nrm -rf /\n") is None


def test_probe_reads_metadata(tmp_video):
    info = video.probe(tmp_video(n=80, step=6, fps=20))
    assert (info.width, info.height) == (480, 360) and info.fps == 20 and info.frames == 80
    assert abs(info.duration_s - 4.0) < 0.01


def test_probe_rejects_corrupted_short_and_tiny_videos(tmp_path, tmp_video):
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"\0\0\0\x18ftypisom" + b"\x00garbage" * 200)
    with pytest.raises(video.VideoError, match="could not be opened|No frame could be decoded"):
        video.probe(bad)
    with pytest.raises(video.VideoError, match="only 1.0 s long"):
        video.probe(tmp_video("short.mp4", n=20, step=6, fps=20))
    with pytest.raises(video.VideoError, match="resolution"):
        video.probe(tmp_video("tiny.mp4", n=60, step=6, fps=20, size=(200, 150)))


def test_keyframes_skip_blurry_and_motionless_frames(tmp_path, tmp_video):
    # 8 s at 20 fps: steady pan, a 2 s pause (near-duplicates), and the last 2 s blurred.
    path = tmp_video(n=160, step=5, fps=20, still_from=60, still_to=100, blur_from=120)
    s = ProcessingSettings(sample_fps=5, min_motion=0.02)
    m = video.select_keyframes(path, tmp_path / "frames", s)
    assert m["sampled"] == 40
    assert m["rejected"]["blurry"] >= 9                       # the blurred tail (10 samples)
    assert m["rejected"]["duplicate"] >= 6                    # the pause
    kf = m["keyframes"]
    assert 8 <= len(kf) <= 30 and not m.get("error")
    assert all(f["index"] < 120 for f in kf)                  # no blurred frame selected
    assert all(not (60 < f["index"] < 100) for f in kf)       # nothing new while the camera stood still
    assert [f["time"] for f in kf] == sorted(f["time"] for f in kf)
    for f in kf:
        assert (tmp_path / "frames" / f["name"]).is_file()
    saved = json.loads((tmp_path / "frames" / "manifest.json").read_text())
    assert saved["keyframes"] == kf and len(saved["timeline"]) == 40


def test_keyframes_are_thinned_evenly_to_the_limit(tmp_path, tmp_video):
    path = tmp_video(n=200, step=8, fps=20)
    m = video.select_keyframes(path, tmp_path / "f", ProcessingSettings(sample_fps=10, min_motion=0.005,
                                                                        max_keyframes=12))
    assert len(m["keyframes"]) == 12 and m["rejected"]["thinned"] > 0
    names = sorted(p.name for p in (tmp_path / "f").glob("*.jpg"))
    assert names == [f["name"] for f in m["keyframes"]]       # thinned files removed, names contiguous


def test_a_static_video_is_rejected_with_an_explanation(tmp_path, tmp_video):
    path = tmp_video(n=100, step=0, fps=20)
    m = video.select_keyframes(path, tmp_path / "f", ProcessingSettings())
    assert "Camera motion or visual overlap is insufficient" in m["error"]


def test_settings_are_validated():
    assert ProcessingSettings.clean({"sample_fps": 2, "completion": False}).completion is False
    with pytest.raises(ValueError, match="max_keyframes"):
        ProcessingSettings.clean({"max_keyframes": 5000})
