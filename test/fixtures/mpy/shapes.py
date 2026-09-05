"""ModuleDocstringZZZ — this docstring must NOT survive compilation."""

# Source for shapes.mpy — the fixture behind the "what a .mpy does NOT keep"
# assertions in mpyInfo.test.ts. Regenerate with:
#   mpy-cross -o shapes.mpy shapes.py    (mpy-cross 1.29.0)


def with_defaults(alpha_arg, beta_arg=1):
    """FunctionDocstringZZZ — must not survive either."""
    gamma_local = alpha_arg + beta_arg
    delta_local = gamma_local * 2
    return delta_local


def counter(limit):
    for epsilon_local in range(limit):
        yield epsilon_local


def star_taker(*args_probe, **kwargs_probe):
    return args_probe, kwargs_probe


def kw_only(first_arg, *, zeta_kwonly=2):
    return first_arg + zeta_kwonly
