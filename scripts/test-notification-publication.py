"""Fail if publication tests disappear; report platform skips explicitly."""
import pathlib,sys,unittest

root=pathlib.Path(__file__).resolve().parents[1]
suite=unittest.defaultTestLoader.discover(str(root/'test'),pattern='*_publication_test.py')
if suite.countTestCases()<4:
    raise SystemExit('Publication regression suite incomplete: expected at least four tests.')
result=unittest.TextTestRunner(verbosity=2).run(suite)
raise SystemExit(0 if result.wasSuccessful() else 1)
