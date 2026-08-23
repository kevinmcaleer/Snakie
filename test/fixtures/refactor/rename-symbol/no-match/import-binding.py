# `jsonCodec` is bound by the `import` line, and that line has no name node to
# rewrite — renaming the uses alone would leave the binding behind.
def load_config(path):
    import ujson as jsonCodec

    with open(path) as handle:
        return jsonCodec.load(handle)
