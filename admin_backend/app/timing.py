import random


def randomized_interval(base, enabled=True, extra=0):
    """Add a fresh delay without reducing the configured minimum interval."""
    return base + random.uniform(0, extra) if enabled and extra > 0 else base
