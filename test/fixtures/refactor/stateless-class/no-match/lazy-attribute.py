"""State that arrives on first use is still state.

The one `self.<name>` this rule forgives is the method calling itself. Here the
name matches the method but the use is an assignment: the first call replaces
`offset` with the value it read, so the second call returns a cached number
instead of touching the EEPROM. That is an instance remembering something.
"""


class Calibration:
    def offset(self, eeprom):
        self.offset = eeprom.read(0)
        return self.offset
