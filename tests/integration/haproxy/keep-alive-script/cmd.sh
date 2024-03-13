#!/bin/sh

set -e

echo "test"

data='{"user":"'$USER'","password":"'$PASSWORD'"}'

curl -X POST 'http://api:5988/medic/login' -d $data -H 'Content-Type:application/json'

#wget -S -O - \
#  'http://api:5988/medic/login' \
#  --post-data=$data \
#  --header='Content-Type:application/json' \
#  --header='Connection:Keep-Alive' \
#  --header='Keep-Alive: timeout=5'

