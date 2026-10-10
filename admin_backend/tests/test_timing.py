from app.adapters.spider_xhs import SpiderXHSAdapter
from app.models import Task
from app.timing import randomized_interval


def test_random_interval_samples_each_wait_and_never_shortens_base(monkeypatch):
    samples = iter([0, 3, 1.5])
    monkeypatch.setattr("app.timing.random.uniform", lambda low, high: next(samples))
    waits = []
    monkeypatch.setattr("app.adapters.spider_xhs.time.sleep", waits.append)
    adapter = SpiderXHSAdapter(cookie="", request_interval=5)
    for _ in range(3):
        adapter._wait_request()
    assert waits == [5, 8, 6.5]


def test_disabled_randomization_does_not_sample(monkeypatch):
    def unexpected(*args):
        raise AssertionError("disabled randomization must not sample")

    monkeypatch.setattr("app.timing.random.uniform", unexpected)
    assert randomized_interval(300, False, 60) == 300


def test_legacy_tasks_default_to_random_intervals():
    task = Task(name="legacy", keyword="coffee", account_id="account")
    assert task.randomize_task_interval is True
    assert task.task_interval_jitter_seconds == 60
    assert task.randomize_request_interval is True
    assert task.request_interval_jitter_seconds == 3
