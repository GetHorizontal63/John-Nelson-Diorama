@echo off
rem Serve Diorama Maker at http://localhost:5500
rem pushd (not cd) so this also works from a UNC network share
pushd "%~dp0"
python serve.py
