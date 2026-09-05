#!/bin/bash
# Patches madmom 0.16.1 (unmaintained since 2018) for Python 3.10 / modern numpy.
# Run once after `pip install madmom --no-build-isolation` — see README.md.
set -e

MADMOM_DIR="$(python3 -c 'import madmom, os; print(os.path.dirname(madmom.__file__))' 2>/dev/null)"
if [ -z "$MADMOM_DIR" ]; then
  echo "madmom not found on the active Python's path — activate the venv first." >&2
  exit 1
fi

# collections.MutableSequence moved to collections.abc in Python 3.10.
sed -i 's/from collections import MutableSequence/from collections.abc import MutableSequence/' \
  "$MADMOM_DIR/processors.py"

# np.float / np.int / etc. were removed as deprecated aliases in numpy 1.24+.
for f in $(grep -rlE 'np\.(float|int|bool|object|complex|str)\b' --include='*.py' "$MADMOM_DIR"); do
  sed -i -E 's/\bnp\.float\b/float/g; s/\bnp\.int\b/int/g; s/\bnp\.bool\b/bool/g; s/\bnp\.object\b/object/g; s/\bnp\.complex\b/complex/g; s/\bnp\.str\b/str/g' "$f"
done

echo "madmom patched at $MADMOM_DIR"
