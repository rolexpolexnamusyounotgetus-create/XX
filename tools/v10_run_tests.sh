#!/bin/bash
# v10_run_tests.sh: runs the jobs in $TESTDIR/_jobs.txt (default data/derived/v10/tests; tools/test_jobs_standard.txt when the dir has none) with up to 3 in parallel under nice -n 5; one log per job, rc per job in _status.txt
cd /home/user/XX
D=${TESTDIR:-data/derived/v10/tests}
mkdir -p $D
# v10 review: without a job list in $D, use the standard list (every tests/test_* file, incl. test_props_capture.py and the page engine test_engine2.js)
[ -f $D/_jobs.txt ] || cp tools/test_jobs_standard.txt $D/_jobs.txt
rm -f $D/_status.txt
run() { name=$1; shift; nice -n 5 bash -c "$*" > $D/$name.log 2>&1; echo "$name rc=$?" >> $D/_status.txt; }
export -f run; export D
cat $D/_jobs.txt | while read name cmd; do echo "$name|$cmd"; done | xargs -P 3 -I{} bash -c 'n="${1%%|*}"; c="${1#*|}"; run "$n" "$c"' _ {}
echo ALLDONE >> $D/_status.txt
