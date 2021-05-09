#!/bin/bash

echo $JAVA_HOME
java -version
wget https://github.com/alibaba/nacos/releases/download/1.0.0/nacos-server-2.0.0.zip
unzip nacos-server-2.0.0.zip

chmod 755 ./nacos/bin/startup.sh
nohup ./nacos/bin/startup.sh -m standalone 2>&1 &
sleep 30
cat nohup.out
curl "127.0.0.1:8848/nacos/v1/ns/operator/metrics"