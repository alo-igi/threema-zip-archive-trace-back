# threema-files-trace-back
Retrieve files and conversation texts from a Threema archive


Overview
--------

Threema stores backups as password protected zip archives.
The files in an archive don't have a folder structure; an archive is "flat".
After unarchiving a Threema backup into a folder, a number of files exist, most of them with cryptic filenames, no extensions, and an arbitrary timestamp.

It would be nice ...
- if the files within a conversation (pictures, movies, ...) were kept together,
- if they had a timestamp that corresponded to the moment they were posted, and
- if the conversations were stored as plain texts.

And this is exactly what `threemaFilesTraceBack` does: it collects all texts of a conversation, renames files, sets their timestamp, moves them in folders.


How to use
----------

This is described for Windows, all steps should easily be adaptable to Mac or Linux environments.

- Download `threemaFilesTraceBack.exe` (`threemaFilesTraceBack-macos` for macOS, `threemaFilesTraceBack-linux` for Linux). The file contains a default configuration set.

- If you want to override the standard configuration, download also the JSON configuration file `threemaFilesTraceBack.config` (all operating systems).

- Unarchive one of your Threema backup (`zip`) files into an empty folder. It is strongly recommended that the folder be empty before unarchiving.

- Copy the downloaded `threemaFilesTraceBack.exe` into the same folder.

- In case you work with a different configuration: copy the downloaded `threemaFilesTraceBack.config` into the same folder. Check it with any text editor. Change it according to your needs, save it.

- Double-click `threemaFilesTraceBack.exe`. Wait a few seconds ... and you're all done, that's it.


What it does
------------

`threemaFilesTraceBack` works directly on the files in the chosen folder. First, it creates sub-folders for each contact and group. Then it moves the files for the contact or group into its corresponding sub-folder, then it renames all files, and sets their timestamps to the moment they were posted.

Before running `threemaFilesTraceBack` you have a flat folder with a lot of cryptically named files without extensions, all with mainly the same timestamp.

Afterwards you have a sub-folder structure with human readable foldernames, populated with files with human readable filenames, with correct timetamps, and with correct extensions.

__Note 1:__ with standard configuration `threemaFilesTraceBack` deletes some of the files completely:
- delete thumbnails of pictures with existing original;
- delete duplicates of files within a folder.

This is non-critical since they are quality-reduced duplicates or duplicates in the first place. All files still exist in the original Threema archive file.

__Note 2:__ `threemaFilesTraceBack` cannot determine the timestamp a file was originally created. It can only determine the timestamp a file was posted in a conversation.


If you want or need to know more
--------------------------------

With the standard configuration `threemaFilesTraceBack`  ...
- deletes thumbnails of pictures if the original exists.\
  Set `"deleteThumbnailIfOriginalExists": false,` in the configuration file to change this behavior.
- deletes duplicate files within a folder. It keeps the first one posted.\
  Set `"removeDuplicatesWithinFolder": false,` in the configuration file to change this behavior.
- deletes empty sub-folders.\
  Set `"removeEmptyFolders": false,` in the configuration file to change this behavior.
- lists all duplicate files throughout the whole archive in the file `_duplicates.txt`.\
  Change `"saveDuplicateFileNamesTo": "_duplicates.txt",` in the configuration file according to your needs.\
  Change to `"saveDuplicateFileNamesTo": null,` to skip this step.
- creates a log file with extension `.log` for each run. Only relevant messages are contained.\
  Change the parameter `minimumLevelForLogging` in the configuration file to get less or more information. Allowed values: `"minimumLevelForLogging": "trace",`, `"minimumLevelForLogging": "debug",`, `"minimumLevelForLogging": "info",` (default), `"minimumLevelForLogging": "warn",`, `"minimumLevelForLogging": "error",`, `"minimumLevelForLogging": "fatal",`.\
  Set `"logTo": null,` in the configuration file to omit logging into a file. Logging on the command line, however, still takes place.

You can run `threemaFilesTraceBack.exe` from a command line: `[path]threemaFilesTraceBack [folder] [-r|--recursive] [-?|-h|--help]`

- `[folder]`: [path+]folder with the unarchived Threema files

- `-r` or `--recursive` advises the program to look also for files in sub-folders of `[folder]`. This can be helpful if you run the program on an already processed folder.

- `-?`, `-h`, `--help` displays a short help notice

`threemaFilesTraceBack` formats timestamps according to the configuration. It uses the very lean [strftime](https://github.com/thdoan/strftime); many thanks to [thdoan](https://github.com/thdoan)! However, `threemaFilesTraceBack` adds another placeholder `%à` for 2-character-abbreviated name of the day of the week.

If you use a format that prints names of months or days of the week, you will probably want to change the [configuration file](https://github.com/alo-igi/threema-files-trace-back/blob/main/threemaFilesTraceBack.config) according to your language. The standard configuration uses German terms. 


For programmers
---------------

The project consists of one Nodejs file and the corresponding `package.json`. It is compiled with `pkg`. Compiling with `nexe` worked, however, the generated code showed some strange behavior and could not be used.

Command used for compiling: `pkg threemaFilesTraceBack.js --options max_old_space_size=8192` (creates code for all platforms)

Any suggestions or any feedback is highly appreciated.
