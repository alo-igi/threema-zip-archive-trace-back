# threema-files-trace-back
Retrieve files and conversation texts from a Threema archive

Overview
--------

Threema stores backups as password protected zip archives.
The files in an archive don't have a folder structure; an archive is "flat".
After unarchiving a Threema backup into a folder, a number of files exist, most of them with cryptic filenames.

This command line program creates a folder for each contact and each group, 
renames all files, 
sets their file system timestamps, 
and puts them into the contact or group folder.

How to use
----------

Unarchive 
