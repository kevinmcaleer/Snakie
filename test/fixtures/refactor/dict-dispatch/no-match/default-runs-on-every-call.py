# `TABLE.get(mode, fallback)` evaluates its second argument on EVERY call, where
# the chain only ran the `else` when nothing matched. `duty_for("crawl", None)`
# returns 12000 today; from a lookup table it would raise UnboundLocalError,
# because nothing ever bound `fallback`. The same goes for a default that
# divides — `share("crawl", 10, 0)` returns 1 now and would raise instead.


def duty_for(mode, cfg):
    if cfg:
        fallback = cfg.duty
    if mode == "crawl":
        return 12000
    elif mode == "cruise":
        return 32000
    elif mode == "sprint":
        return 58000
    else:
        return fallback


def share(mode, total, count):
    if mode == "crawl":
        return 1
    elif mode == "cruise":
        return 2
    elif mode == "sprint":
        return 3
    else:
        return total // count
