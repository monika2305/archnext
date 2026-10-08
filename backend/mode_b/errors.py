"""Exceptions shared by the Mode B worker and its pipeline modules."""


class StageFailed(Exception):
    """A stage could not produce a valid result; the message is shown to the user."""
