"""Compatibility import for integrations written before the quapeaks rename."""
import sys
from maw import quapeaks

quapeaks.ReaPeaksFile = quapeaks.ReapeaksFile
sys.modules[__name__] = quapeaks
