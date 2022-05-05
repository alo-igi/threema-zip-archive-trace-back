#!/usr/bin/node
'use strict'

//================================================================================
const author = 'A. Krähenmann, standard.mail@gmx.net'
//--------------------------------------------------------------------------------
const sourceDate = '2022-05-05T18:58:31.243Z'
const sourceVersion = 'v0.9.0'

//================================================================================
// compile with "pkg", don't use "nexe", the generated code is not stable!!!
// pkg threemaFilesTraceBack.js --targets latest-win-x64 --options max_old_space_size=8192
//================================================================================
// Threema stores backups as password protected zip archives.
// The files in an archive don't have a folder structure; an archive is "flat".
// After unarchiving a Threema backup into a folder, a number of files exist,
// most of them with cryptic filenames.
//--------------------------------------------------------------------------------
// A Threema archive consists of:
// 1) some special files with predefined names (e.g. "settings")
// 2) CSV files (content is comma delimited with double quotes)
// 3) files that were attached to messages (pictures, videos, ...)
//--------------------------------------------------------------------------------
// There are two types of CSV files:
// a) containig administrative information (contacts, groups, ...)
// b) containing all messages of a conversation (with a contact or of a group)
//--------------------------------------------------------------------------------
// Each message is a row in a CSV file. The columns contain full information
// about the message: ID, timestamps (Unix epoch), attached file, text, ...
//--------------------------------------------------------------------------------
// This program reads all files of an unpacked Threema archive, analyzes their
// contents, derives additional information and then starts to process all
// relevant files. Some of the action can be configured with corresponding
// configuration parameters (marked with * below):
// - rename file with contact or group name
// - rename file with message timestamp *
// - rename file with file type
// - set operating system file timestamps ("last modified", "last access")
// - create folders for all contacts and all groups
// - move all files for a contact or a group into its folder
// - extract all texts from all conversations
// - store all texts in the file "_texts.txt" in the contact or group folder *
// - delete empty folders for contacts or groups without any actions *
// - find + remove duplicate files in each folder *
// - in the whole archive find duplicate files; save list to file *
//--------------------------------------------------------------------------------
// NOTE: File timestamps are derived from the timestamp a file was posted.
//       The original file "birth" timestamp cannot be determined!
//--------------------------------------------------------------------------------
// This program works directly on the files of an unpacked archive:
// - before processing:
//   - all files are stored flat in one folder
//   - the filenames are cryptic, most extensions/file types are missing
// - after processing:
//   - a lot of sub-folders exist (for each contact and each group)
//   - all recognized files are moved into their corresponding sub-folders
//   - some files still exist in the original folder; most of them CSV files
//--------------------------------------------------------------------------------
// This program takes as a parameter the folder with the unpacked Threema archive.
// A second parameter "/r" or "-r" or "--recursive" advises the program to look
// for files also in sub-folders. Is not needed for a flat unpacked archive.
//--------------------------------------------------------------------------------
// The length of the "main" code is said to indicate bad code. The author knows
// and might change it with a future refactoring; just not now ...
//--------------------------------------------------------------------------------


//================================================================================
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const csvtojson = require('csvtojson') // https://github.com/Keyang/node-csvtojson#api
const fileType = require('file-type')


//--------------------------------------------------------------------------------
// list of CSV columns that contain interesting text:
const textCsvHeaders = ['body', 'caption'] // in fact, they are all mandatory
// full list of CSV columns that are used for processing:
const relevantHeaders = textCsvHeaders.concat(['uid', 'identity', 'type', 'fileTimestamp', 'fileTimestampISO']) // in fact, they are all mandatory
// list of CSV columns that must be present to recognize a file of messages:
const messagesFileHeaders = ['uid', 'type', 'created_at'] // if these headers are present in a CSV file then it contains a list of messages
//--------------------------------------------------------------------------------
// list of CSV columns that contain interesting information in a group file:
const groupCsvHeaders = ['identity', 'fullname', 'id'] // "identity" and "fullname" are a must have; used to filter!
// list of CSV columns that contain interesting information in a contact file:
const contactCsvHeaders = groupCsvHeaders

//--------------------------------------------------------------------------------
const findOriginal = { // if two files differ in their names exclusively by "find" vs. "original", the "find" file will be marked with "found"; can be deleted:
	find: 'thumbnail',
	original: 'media',
	found: '~_'
}
const specialFilenames = { // files with these names must be handled especially:
	contacts: 'contacts',
	groups: 'groups'
}
const skipFilenames = ['ballot', 'ballot_choice', 'ballot_vote', 'distribution_list'].concat(Object.values(specialFilenames))
const csvToJson = { // parameters for the CSV to JSON conversion; derived from the file format Threema is generating:
	noheader: false,
	delimiter: ',',
	quote: '"'
}
//--------------------------------------------------------------------------------
const logLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']
const logLevelTrace = 0 // for convenience and code stability
const logLevelDebug = 1 // for convenience and code stability
const logLevelInfo = 2 // for convenience and code stability
const logLevelWarn = 3 // for convenience and code stability
const logLevelError = 4 // for convenience and code stability
const logLevelFatal = 5 // for convenience and code stability
//--------------------------------------------------------------------------------
// command line parameters:
const cmdParam1 = 'recursive'
const cmdParam2 = 'help'
const cmdParam3 = '?'
// type declarations for command line argument checks:
const invalidParamTypePath = 1
const invalidParamTypeSwitch = 2

//--------------------------------------------------------------------------------
const cfgFileExtension = '.config'
const logFileExtension = '.log'

//--------------------------------------------------------------------------------
// The parameters for logging are a circle of the "chicken and the egg": must be used before being defined definitely; best approximation: will be adjusted several times with more information available
let globals = {
	logFile: null,
	logLevel: null,
	prgDir: path.dirname(process.argv[1]),
	prgBasename: path.basename(process.argv[1]),
	prgName: path.basename(process.argv[1], path.extname(process.argv[1])),
	prgExt: path.extname(process.argv[1])
}
// Derive configuration filename from program filename:
globals.cfgFile = ensureTrailingSlash() + globals.prgName + cfgFileExtension


//--------------------------------------------------------------------------------
// Default values and prototype; may be overwritten by ".config" JSON file:
let configuration = {
	minimumLevelForLogging: logLevels[logLevelInfo],
	logTo: globals.prgName + '_' + epochToLocal((new Date()).getTime()).toISOString().replace(/\.\d+/, '').replace(/[^\d]/g, '') + logFileExtension,
	deleteThumbnailIfOriginalExists: true,
	removeDuplicatesWithinFolder: true,
	removeEmptyFolders: true,
	saveDuplicateFileNamesTo: '_duplicates.txt',
	saveMessagesTextsTo: '_texts.txt',
	fileTimestampFormat: '%Y-%m-%d %H:%M:%S', // https://github.com/thdoan/strftime/blob/master/strftime.js
	textTimestampFormat: '%Y-%m-%d %H:%M:%S', // https://github.com/thdoan/strftime/blob/master/strftime.js
	days: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
	months: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
	replaceFileNamePart: {
		group: '',
		media: '',
		message: '',
		thumbnail: 'tn'
	},
	replaceStringPart: {
		//'_': '+',
		//'~': '!!!!!!'
	}
}
adjustLogParameters(ensureTrailingSlash(), configuration) // re-define log parameters with current path and current configuration


//--------------------------------------------------------------------------------
// Adjust "globals.logFile" with current configuration:
function adjustLogParameters(sourceDir, configuration) {
	globals.logLevel = logLevels.indexOf(configuration.minimumLevelForLogging)
	if ((typeof configuration.logTo === 'string') && configuration.logTo) {
		globals.logFile = sourceDir + configuration.logTo
	}
}

//--------------------------------------------------------------------------------
// If a configuration file exists: overwrite default configuration:
function readConfiguration(sourceDir) {
	let sPre = `configuration file '` + globals.cfgFile + `' `
	let sPost = `; will use default configuration values:\n` + formatConfiguration(configuration)
	if (pathExistsSync(globals.cfgFile)) {
		try {
			let data = fs.readFileSync(globals.cfgFile, 'utf8') // may throw
			try {
				data = JSON.parse(data) // may throw
				// check data:
				if (Array.isArray(data) || (typeof data !== 'object')) {
					throw new Error('no object')
				}
				for (let key in data) {
					if (data[key] === undefined) {
						delete data[key]

					} else if (configuration[key] === undefined) {
						throw new Error(`forbidden key '` + key + `'`)

					} else if (Array.isArray(configuration[key])) {
						if (!Array.isArray(data[key])) {
							throw new Error(`key '` + key + `' must be an array`)
						}

					} else if (typeof data[key] === 'object') {
						for (let subKey in data[key]) {
							if (typeof data[key][subKey] !== 'string') {
								throw new Error(`key '` + subKey + `' in key '` + key + `' must be a string`)
							}
						}
					}
				}
				Object.assign(configuration, (data || {}))
				adjustLogParameters(sourceDir, configuration)
				if (globals.logLevel < 0) {
					globals.logLevel = logLevels[logLevelInfo]
					doLog(logLevelWarn, `invalid minimum logging level found; will use '` + globals.logLevel + `'`)
				}
				doLog(logLevelInfo, `will use data from configuration file '` + globals.cfgFile + `':\n` + formatConfiguration(configuration))

			} catch(err) {
				doLog(logLevelError, sPre + `does not contain a valid JSON object; ` + err + sPost)
			}

		} catch(err) {
			doLog(logLevelError, sPre + `not readable; ` + err + sPost)
		}

	} else {
		doLog(logLevelInfo, sPre + `not found` + sPost)
	}
}

//--------------------------------------------------------------------------------
// Format configuration object for logging output:
function formatConfiguration(o) {
	// first, split object into individual lines, then re-join the lines for each array:
	return JSON.stringify(o, null, 2).split('\n').map(s => '  ' + s).join('\n').replace(/\[([^\]]*)\]/g, ($1, $2) => `[` + $2.replace(/\s+/g, ' ').trim() + `]`)
}

//--------------------------------------------------------------------------------
// Print help/usage message:
function usage(exitCode = 0) {
	doLog(``, `-------------------------------------------------------------------------------`)
	doLog(``, `Analyze files of an unpacked Threema archive,`)
	doLog(``, `create folder structure from contacts and groups,`)
	doLog(``, `rename files, set their timestamps, move them into their respective folders.`)
	doLog(``, `-------------------------------------------------------------------------------`)
	doLog(``, `Use configuration from file ' ` + globals.cfgFile + `';`)
	doLog(``, `use standard configuration if file does not exist.`)
	doLog(``, `-------------------------------------------------------------------------------`)
	doLog(``, `Follow these steps:`)
	doLog(``, `- create empty folder somewhere`)
	doLog(``, `- unpack Threema archive into empty folder`)
	doLog(``, `- either copy this program into same folder and double-click,`)
	doLog(``, `- or call this program from command line; provide file folder path+name,`)
	doLog(``, `  if different from folder where this program is stored`)
	doLog(``, `-------------------------------------------------------------------------------`)
	doLog(`Command line usage: `, ((/\.js/i.test(globals.prgExt)) ? `node ` : ``) + globals.prgBasename + ` [path-with-threema-files] ` + argvUsage(cmdParam1) + ` [` + argvUsage(cmdParam2, false) + `|` + argvUsage(cmdParam3, false) + `]`)
	doLog(``, `-------------------------------------------------------------------------------`)
	doLog(`Version: `, sourceVersion)
	doLog(`Source:  `, sourceDate)
	doLog(`Author:  `, author)
	doLog(``, `-------------------------------------------------------------------------------`)
	doLog(``, `Program terminates...`)
	doLog(``, ``)
	process.exit(exitCode)
}

//--------------------------------------------------------------------------------
// Do logging if requested level is greater or equal to global log level; or if level is a string:
function doLog(level, s) {
	let ok = (typeof level === 'string')
	if ((typeof level === 'number') && (level >= globals.logLevel)) {
		level = ((level === 0) ? `Trace` : ((level === 1) ? `Debug` : ((level === 2) ? `Information` : ((level === 3) ? `Warning` : ((level === 4) ? `Error` : ((level === 5) ? `Fatal error` : `???`)))))) + `: `
		ok = true
	}
	if (ok) {
		console.log(level + s)
		if (globals.logFile) {
			try {
				fs.appendFileSync(globals.logFile, level + s + '\n', 'utf8')

			} catch(err) {
				console.log(`Error: could not add line to log file '` + globals.logFile + `'; ` + err)
			}
		}
	}
}

//--------------------------------------------------------------------------------
// Returns the English plural for string "s":
function plural(s) {
	if ((typeof s === 'string') && s) {
		const sLast = s.slice(-1)
		if (sLast === 's') {
			s += 'es'
		} else if (sLast === 'S') {
			s += 'ES'
		} else if (sLast === 'y') {
			s += 'ies'
		} else if (sLast === 'Y') {
			s += 'IES'
		} else if (sLast === sLast.toUpperCase()) {
			s += 'S'
		} else {
			s += 's'
		}
		return s.replace(/yies$/, 'ies').replace(/YIES$/, 'IES')

	} else {
		return null
	}
}

//--------------------------------------------------------------------------------
// Returns the number plus the English plural for string "s":
function singularPlural(n, s, includeNr = true) {
	if (typeof s === 'string') {
		if (n != 1) {
			s = plural(s)
		}
		if (includeNr) {
			s = n + ' ' + s
		}
	}
	return s
}

//--------------------------------------------------------------------------------
// https://github.com/thdoan/strftime/blob/master/strftime.js
/* Port of strftime() by T. H. Doan (https://thdoan.github.io/strftime/)
 *
 * Day of year (%j) code based on Joe Orost's answer:
 * http://stackoverflow.com/questions/8619879/javascript-calculate-the-day-of-the-year-1-366
 *
 * Week number (%V) code based on Taco van den Broek's prototype:
 * http://techblog.procurios.nl/k/news/view/33796/14863/calculate-iso-8601-week-and-year-in-javascript.html
 */
function strftime(date, sFormat) {
	if (!(date instanceof Date)) date = new Date();
	var nDay = date.getDay(),
		nDate = date.getDate(),
		nMonth = date.getMonth(),
		nYear = date.getFullYear(),
		nHour = date.getHours(),
		aDayCount = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334],
		isLeapYear = function() {
			return (nYear%4===0 && nYear%100!==0) || nYear%400===0;
		},
		getThursday = function() {
			var target = new Date(date);
			target.setDate(nDate - ((nDay+6)%7) + 3);
			return target;
		},
		zeroPad = function(nNum, nPad) {
			return ((Math.pow(10, nPad) + nNum) + '').slice(1);
		};
	return sFormat.replace(/%[a-z]/gi, function(sMatch) {
		return (({
			'%à': configuration.days[nDay].slice(0,2),
			'%a': configuration.days[nDay].slice(0,3),
			'%A': configuration.days[nDay],
			'%b': configuration.months[nMonth].slice(0,3),
			'%B': configuration.months[nMonth],
			'%c': date.toUTCString(),
			'%C': Math.floor(nYear/100),
			'%d': zeroPad(nDate, 2),
			'%e': nDate,
			'%F': date.toISOString().slice(0,10),
			'%G': getThursday().getFullYear(),
			'%g': (getThursday().getFullYear() + '').slice(2),
			'%H': zeroPad(nHour, 2),
			'%I': zeroPad((nHour+11)%12 + 1, 2),
			'%j': zeroPad(aDayCount[nMonth] + nDate + ((nMonth>1 && isLeapYear()) ? 1 : 0), 3),
			'%k': nHour,
			'%l': (nHour+11)%12 + 1,
			'%m': zeroPad(nMonth + 1, 2),
			'%n': nMonth + 1,
			'%M': zeroPad(date.getMinutes(), 2),
			'%p': (nHour<12) ? 'AM' : 'PM',
			'%P': (nHour<12) ? 'am' : 'pm',
			'%s': Math.round(date.getTime()/1000),
			'%S': zeroPad(date.getSeconds(), 2),
			'%u': nDay || 7,
			'%V': (function() {
							var target = getThursday(),
								n1stThu = target.valueOf();
							target.setMonth(0, 1);
							var nJan1 = target.getDay();
							if (nJan1!==4) target.setMonth(0, 1 + ((4-nJan1)+7)%7);
							return zeroPad(1 + Math.ceil((n1stThu-target)/604800000), 2);
						})(),
			'%w': nDay,
			'%x': date.toLocaleDateString(),
			'%X': date.toLocaleTimeString(),
			'%y': (nYear + '').slice(2),
			'%Y': nYear,
			'%z': date.toTimeString().replace(/.+GMT([+-]\d+).+/, '$1'),
			'%Z': date.toTimeString().replace(/.+\((.+?)\)$/, '$1')
		}[sMatch] || '') + '') || sMatch;
	});
}

//--------------------------------------------------------------------------------
// Return usage string for valid parameter:
function argvUsage(param, optional = true) {
	param = '-' + param.charAt(0) + '|' + '--' + param
	return ((optional) ? '[' + param + ']' : param)
}

//--------------------------------------------------------------------------------
// check if "argv" is "-p" or "--param":
function argvSwitch(argv, param) {
	if ((argv === '-' + param.charAt(0)) || (argv === '--' + param)) {
		return true
	}
	return ((/^\-\w$/.test(argv) || /^\-\-\w+$/.test(argv)) ? undefined : false) // return "undefined" if it is an invalid parameter, "false" otherwise
}

//--------------------------------------------------------------------------------
// Check synchronously if file exists (current user is allowed to read):
function pathExistsSync(fullName) {
	try {
		return fs.existsSync(fullName)

	} catch(err) {
		doLog(logLevelError, `could not check if '` + fullName + `' exists; returning 'false'; ` + err)
		return false
}}

//--------------------------------------------------------------------------------
// Create folder synchronously:
function createDirSync(path, recursive = true) {
	try {
		if (!pathExistsSync(path)) {
			fs.mkdirSync(path, { recursive: recursive }) // "recursive" creates all the needed folders "on the way"
		}

	} catch(err) {
		doLog(logLevelError, `could not create directory '` + path + `'; ` + err)
		throw err
	}
}

//--------------------------------------------------------------------------------
// Return file path with no backslashes "\":
function normalizePath(s) {
	return ((s) ? s.replace(/\\/g, '/') : '')
}

//--------------------------------------------------------------------------------
// Return file path with no backslashes "\" and definitely no trailing slash "/":
function ensureNoTrailingSlash(s) {
	return ((s) ? normalizePath(s).replace(/\/+$/, '') : '.' /*globals.prgDir*/)
}

//--------------------------------------------------------------------------------
// Return file path with no backslashes "\" and definitely a trailing slash "/":
function ensureTrailingSlash(s) {
	return ensureNoTrailingSlash(s) + '/'
}

//--------------------------------------------------------------------------------
// Return the sha256 hash for a file:
function getHash(file, fullName) {
	try {
		const fileBuffer = fs.readFileSync(fullName)
		let hashSum = crypto.createHash('sha256')
		hashSum.update(fileBuffer)
		hashSum = hashSum.digest('hex')

		// replace filename+extension part of "fullName" by the hash:
		let path = normalizePath(fullName).split('/')
		path[path.length - 1] = hashSum // overwrite filename+extension part with hash

		// add new information to original object:
		file.hash = hashSum
		file.pathHash = path.join('/')

	} catch(err) {
		doLog(logLevelError, `could not calculate hash for file '` + fullName + `'; ` + err)
	}
}

//--------------------------------------------------------------------------------
// Get the timestamp (stored as guid) in a filename from known timestamps:
function timestampFromFilename(a, fileTimestamps) {
	if (!Array.isArray(a)) { // string was provided:
		a = a.split('_')
	}
	for (let s of a) {
		if (fileTimestamps[s] !== undefined) {
			return fileTimestamps[s]
		}
	}
	return null
}

//--------------------------------------------------------------------------------
// Get the identity (stored as guid) stored in a filename from known identities:
function identityFromFilename(a, identities) {
	if (!Array.isArray(a)) { // string was provided:
		a = a.split('_')
	}
	for (let s of a) {
		if (identities[s] !== undefined) {
			return identities[s]
		}
	}
	// none found, try brute force: try to find a string part in the keys "id":
	for (let s of a) {
		for (let key in identities) {
			if (identities[key].id && (identities[key].id === s)) {
				return identities[key]
			}
		}
	}
	return null
}

//--------------------------------------------------------------------------------
// Try to replace parts of a filename by known identities and by replacements defined in the configuration:
// params = { includeReplaceParts [true|false], includeReplaceChars [true|false] }
function replaceNameParts(a, identities, params) {
	if (!Array.isArray(a)) { // string was provided:
		a = a.split('_')
	}
	for (let i = 0; i < a.length; i++) {
		let identity = identityFromFilename(a[i], identities)
		if (identity) {
			a[i] = identity.fullname

		} else if (params && params.includeReplaceParts && (configuration.replaceFileNamePart[a[i]] !== undefined)) {
			a[i] = configuration.replaceFileNamePart[a[i]]
		}
	}
	// make the filename string:
	let s = a.join('_').replace(/_{2,}/g, '_').replace(/^_/, '').replace(/[_.]+$/, '')
	// do further replacements on the string if requested:
	if (params && params.includeReplaceChars) {
		for (let key in configuration.replaceStringPart) {
			s = s.split(key).join(configuration.replaceStringPart[key])
		}
	}
	return validPlatformName(s)
}

//--------------------------------------------------------------------------------
// Convert string "s" into normalized string without line breaks or tabs:
function cleanText(s, delimiter = ' ↲ ') {
	if (typeof s !== 'string') {
		s = String(s)
	}
	return s.replace(/^\s+/, '').replace(/\s+$/, '').replace(/[\r\n\b\f]/g, '\t').replace(/\t+/g, delimiter).replace(/\s+/g, ' ').trim()
}

//--------------------------------------------------------------------------------
// Convert string "s" into valid string for current platform:
function validPlatformName(s) {
	// replace non-printable unicode characters:
	const re = /[\0-\x1F\x7F-\x9F\xAD\u0378\u0379\u037F-\u0383\u038B\u038D\u03A2\u0528-\u0530\u0557\u0558\u0560\u0588\u058B-\u058E\u0590\u05C8-\u05CF\u05EB-\u05EF\u05F5-\u0605\u061C\u061D\u06DD\u070E\u070F\u074B\u074C\u07B2-\u07BF\u07FB-\u07FF\u082E\u082F\u083F\u085C\u085D\u085F-\u089F\u08A1\u08AD-\u08E3\u08FF\u0978\u0980\u0984\u098D\u098E\u0991\u0992\u09A9\u09B1\u09B3-\u09B5\u09BA\u09BB\u09C5\u09C6\u09C9\u09CA\u09CF-\u09D6\u09D8-\u09DB\u09DE\u09E4\u09E5\u09FC-\u0A00\u0A04\u0A0B-\u0A0E\u0A11\u0A12\u0A29\u0A31\u0A34\u0A37\u0A3A\u0A3B\u0A3D\u0A43-\u0A46\u0A49\u0A4A\u0A4E-\u0A50\u0A52-\u0A58\u0A5D\u0A5F-\u0A65\u0A76-\u0A80\u0A84\u0A8E\u0A92\u0AA9\u0AB1\u0AB4\u0ABA\u0ABB\u0AC6\u0ACA\u0ACE\u0ACF\u0AD1-\u0ADF\u0AE4\u0AE5\u0AF2-\u0B00\u0B04\u0B0D\u0B0E\u0B11\u0B12\u0B29\u0B31\u0B34\u0B3A\u0B3B\u0B45\u0B46\u0B49\u0B4A\u0B4E-\u0B55\u0B58-\u0B5B\u0B5E\u0B64\u0B65\u0B78-\u0B81\u0B84\u0B8B-\u0B8D\u0B91\u0B96-\u0B98\u0B9B\u0B9D\u0BA0-\u0BA2\u0BA5-\u0BA7\u0BAB-\u0BAD\u0BBA-\u0BBD\u0BC3-\u0BC5\u0BC9\u0BCE\u0BCF\u0BD1-\u0BD6\u0BD8-\u0BE5\u0BFB-\u0C00\u0C04\u0C0D\u0C11\u0C29\u0C34\u0C3A-\u0C3C\u0C45\u0C49\u0C4E-\u0C54\u0C57\u0C5A-\u0C5F\u0C64\u0C65\u0C70-\u0C77\u0C80\u0C81\u0C84\u0C8D\u0C91\u0CA9\u0CB4\u0CBA\u0CBB\u0CC5\u0CC9\u0CCE-\u0CD4\u0CD7-\u0CDD\u0CDF\u0CE4\u0CE5\u0CF0\u0CF3-\u0D01\u0D04\u0D0D\u0D11\u0D3B\u0D3C\u0D45\u0D49\u0D4F-\u0D56\u0D58-\u0D5F\u0D64\u0D65\u0D76-\u0D78\u0D80\u0D81\u0D84\u0D97-\u0D99\u0DB2\u0DBC\u0DBE\u0DBF\u0DC7-\u0DC9\u0DCB-\u0DCE\u0DD5\u0DD7\u0DE0-\u0DF1\u0DF5-\u0E00\u0E3B-\u0E3E\u0E5C-\u0E80\u0E83\u0E85\u0E86\u0E89\u0E8B\u0E8C\u0E8E-\u0E93\u0E98\u0EA0\u0EA4\u0EA6\u0EA8\u0EA9\u0EAC\u0EBA\u0EBE\u0EBF\u0EC5\u0EC7\u0ECE\u0ECF\u0EDA\u0EDB\u0EE0-\u0EFF\u0F48\u0F6D-\u0F70\u0F98\u0FBD\u0FCD\u0FDB-\u0FFF\u10C6\u10C8-\u10CC\u10CE\u10CF\u1249\u124E\u124F\u1257\u1259\u125E\u125F\u1289\u128E\u128F\u12B1\u12B6\u12B7\u12BF\u12C1\u12C6\u12C7\u12D7\u1311\u1316\u1317\u135B\u135C\u137D-\u137F\u139A-\u139F\u13F5-\u13FF\u169D-\u169F\u16F1-\u16FF\u170D\u1715-\u171F\u1737-\u173F\u1754-\u175F\u176D\u1771\u1774-\u177F\u17DE\u17DF\u17EA-\u17EF\u17FA-\u17FF\u180F\u181A-\u181F\u1878-\u187F\u18AB-\u18AF\u18F6-\u18FF\u191D-\u191F\u192C-\u192F\u193C-\u193F\u1941-\u1943\u196E\u196F\u1975-\u197F\u19AC-\u19AF\u19CA-\u19CF\u19DB-\u19DD\u1A1C\u1A1D\u1A5F\u1A7D\u1A7E\u1A8A-\u1A8F\u1A9A-\u1A9F\u1AAE-\u1AFF\u1B4C-\u1B4F\u1B7D-\u1B7F\u1BF4-\u1BFB\u1C38-\u1C3A\u1C4A-\u1C4C\u1C80-\u1CBF\u1CC8-\u1CCF\u1CF7-\u1CFF\u1DE7-\u1DFB\u1F16\u1F17\u1F1E\u1F1F\u1F46\u1F47\u1F4E\u1F4F\u1F58\u1F5A\u1F5C\u1F5E\u1F7E\u1F7F\u1FB5\u1FC5\u1FD4\u1FD5\u1FDC\u1FF0\u1FF1\u1FF5\u1FFF\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2072\u2073\u208F\u209D-\u209F\u20BB-\u20CF\u20F1-\u20FF\u218A-\u218F\u23F4-\u23FF\u2427-\u243F\u244B-\u245F\u2700\u2B4D-\u2B4F\u2B5A-\u2BFF\u2C2F\u2C5F\u2CF4-\u2CF8\u2D26\u2D28-\u2D2C\u2D2E\u2D2F\u2D68-\u2D6E\u2D71-\u2D7E\u2D97-\u2D9F\u2DA7\u2DAF\u2DB7\u2DBF\u2DC7\u2DCF\u2DD7\u2DDF\u2E3C-\u2E7F\u2E9A\u2EF4-\u2EFF\u2FD6-\u2FEF\u2FFC-\u2FFF\u3040\u3097\u3098\u3100-\u3104\u312E-\u3130\u318F\u31BB-\u31BF\u31E4-\u31EF\u321F\u32FF\u4DB6-\u4DBF\u9FCD-\u9FFF\uA48D-\uA48F\uA4C7-\uA4CF\uA62C-\uA63F\uA698-\uA69E\uA6F8-\uA6FF\uA78F\uA794-\uA79F\uA7AB-\uA7F7\uA82C-\uA82F\uA83A-\uA83F\uA878-\uA87F\uA8C5-\uA8CD\uA8DA-\uA8DF\uA8FC-\uA8FF\uA954-\uA95E\uA97D-\uA97F\uA9CE\uA9DA-\uA9DD\uA9E0-\uA9FF\uAA37-\uAA3F\uAA4E\uAA4F\uAA5A\uAA5B\uAA7C-\uAA7F\uAAC3-\uAADA\uAAF7-\uAB00\uAB07\uAB08\uAB0F\uAB10\uAB17-\uAB1F\uAB27\uAB2F-\uABBF\uABEE\uABEF\uABFA-\uABFF\uD7A4-\uD7AF\uD7C7-\uD7CA\uD7FC-\uF8FF\uFA6E\uFA6F\uFADA-\uFAFF\uFB07-\uFB12\uFB18-\uFB1C\uFB37\uFB3D\uFB3F\uFB42\uFB45\uFBC2-\uFBD2\uFD40-\uFD4F\uFD90\uFD91\uFDC8-\uFDEF\uFDFE\uFDFF\uFE1A-\uFE1F\uFE27-\uFE2F\uFE53\uFE67\uFE6C-\uFE6F\uFE75\uFEFD-\uFF00\uFFBF-\uFFC1\uFFC8\uFFC9\uFFD0\uFFD1\uFFD8\uFFD9\uFFDD-\uFFDF\uFFE7\uFFEF-\uFFFB\uFFFE\uFFFF]/g
	s = s.replace(re, '.')
	// platform specific:
	if (/^win/i.test(process.platform)) {
		s = s.replace(/[:<>"/\\|?*]/g, '.')

	} else if (/^linux/i.test(process.platform)) {
		s = s.replace(/\//g, '.')
	}
	return s.replace(/\.{2,}/g, '.')
}

//--------------------------------------------------------------------------------
// Converts milliseconds since epoch in a timestamp in server local timezone (ISO format):
function epochToLocal(epoch) {
	return new Date(new Date(new Date(Number(epoch))) + ' UTC')
}

//--------------------------------------------------------------------------------
// Make sure object "o" contains exactly the keys contained in array "a":
function normalizeObj(o, a, defaultVal = null) {
	// remove unwanted keys:
	for (let key in o) {
		if (a.indexOf(key) === -1) {
			delete o[key]
		}
	}
	// add missing keys:
	for (let s of a) {
		if (o[s] === undefined) {
			o[s] = defaultVal
		}
	}
	return o
}

//--------------------------------------------------------------------------------
// Converts an array of objects into an object using "key" in the objects as key for the new object:
function arrayToObject(a, key) {
	if (Array.isArray(a)) {
		// return Object.assign({}, ...a.map(o => ({[o[key]]: o}))) ==> ERROR: "Maximum call stack size exceeded"
		return a.reduce((obj, item) => {
			obj[item[key]] = item
			return obj
		}, {})

	} else {
		return {}
	}
}

//--------------------------------------------------------------------------------
// Return "true" if array "b" is contained completely in array "a":
function arrayContainsArray(a, b) {
	return !b.some(val => a.indexOf(val) === -1)
}

//--------------------------------------------------------------------------------
// Function to sort alphabetically an array of objects by some specific key. Works directly on the original array!
// Call: a.sort(dynamicSort('[key]')) (asc) or a.sort(dynamicSort('-[key]')) (desc)
function dynamicSort(key) {
	let sortOrder = 1
	if (key[0] === '-') {
		sortOrder = -1
		key = key.slice(1)
	}

	return (a, b) => {
		if (sortOrder === -1) {
			return b[key].localeCompare(a[key])
		} else {
			return a[key].localeCompare(b[key])
		}
	}
}

//--------------------------------------------------------------------------------
// Read (recursively) all files from a directory and return them unordered as array of objects with keys fullname, root, dir, base, ext, name, dev, mode, nlink, uid, gid, rdev, blksize, ino, size, blocks, atimeMs, mtimeMs, ctimeMs, birthtimeMs, atime, mtime, ctime, birthtime:
// Collect all empty folders "on the way", remove them in the end if "delEmptyFolders" is "true."
function readDirSync(dir, recursive, fullnameRegExp, delEmptyFolders = false) {
	try {
		let files = [] // list of files, no sub-folders
		let empties = [] // gather empty sub-folders on the way
		fs.readdirSync(dir).forEach(filename => {
			let file = { fullname: path.resolve(dir, filename) }
			Object.assign(file, path.parse(file.fullname))
			//console.log(JSON.stringify(file))
			const stat = fs.statSync(file.fullname)
			if (stat.isDirectory() && recursive) {
				let l = files.length
				files = files.concat(readDirSync(file.fullname, recursive, fullnameRegExp, delEmptyFolders))
				if (files.length === l) {
					empties.push(String(file.fullname.length).padStart(5, '0') + '\t' + file.fullname) // add sort string to the left; tab-delimited
				}

			} else if (stat.isFile() && ((!fullnameRegExp) || fullnameRegExp.test(file.fullname))) {
				files.push(Object.assign(file, stat))
			}
		})
		// remove empty folders if requested:
		if (delEmptyFolders) {
			empties.sort() // sort by string length; delete from longer paths to shorter paths
			for (let i = empties.length - 1; i >= 0; i--) {
				try {
					fs.rmdirSync(empties[i].split('\t')[1])
					doLog(logLevelDebug, `ok, could delete empty folder '` + empties[i].split('\t')[1] + `'`)

				} catch(err) {
					doLog(logLevelError, `could not delete empty folder '` + empties[i].split('\t')[1] + `'; ` + err)
				}
			}
		}
		return files // contains all keys of "fs.parse()" and "fs.stat()"

	} catch(err) {
		doLog(logLevelError, `could not ` + ((recursive) ? `recursively ` : ``) + `get list of files` + ((fullnameRegExp) ? ` fulfilling ` + fullnameRegExp.toString() : ``) + ` from directory '` + dir + `'; ` + err)
		throw err
	}
}

//--------------------------------------------------------------------------------
// Read csv file, convert it to JSON and return the resulting array:
async function getCsvFileAsJSON(file, isMessagesCsv = true) {
	try {
		let data = fs.readFileSync(file, 'utf8') // may throw
		if (data) {
			let headers = []
			data = await csvtojson(Object.assign({ // some sacrosanct values:
				output: 'json',
				checkType: false,
				flatKeys: false,
				nullObject: true
			}, csvToJson)).on('header', (row) => { headers = row }).fromString(data)
			const lower = headers.map(s => s.toLowerCase()) // strict low case
			//doLog(logLevelFatal, '========>>>>>\t' + file + '\t' + headers.join('\t'))
			if (arrayContainsArray(lower, messagesFileHeaders)) { // CSV file contains list of messages:
				return data

			} else if (!isMessagesCsv) { // general csv requested:
				return data

			} else { // just any non-interesting csv:
				return []
			}

		} else {
			let err = new Error(`no data contained`)
			throw err
		}

	} catch(err) {
		doLog(logLevelError, `could not read file '` + file + `' and convert it to JSON; ` + err)
		throw err
	}
}


;//--------------------------------------------------------------------------------
// "main" = self-invocation of an async function:
(async () => {
	// set default values:
	let sourceDir = ensureTrailingSlash() // use current directory
	let recursive = false
	adjustLogParameters(sourceDir, configuration)

	// overwrite default configuration if configuration file is present:
	readConfiguration(sourceDir) // performs also "adjustLogParameters"

	// overwrite defaults with command line parameters; if present:
	let params = process.argv.slice(2) // store command line parameters; first one is "process.argv[2]"
	let invalidParams = []
	for (let i = params.length - 1; i >= 0; i--) { // we work backwards, because we possibly delete from array
		if (pathExistsSync(params[i])) {
			sourceDir = ensureTrailingSlash((params[i] !== '.') ? params[i] : null)
			params.splice(i, 1)

		} else if (argvSwitch(params[i], cmdParam2) || argvSwitch(params[i], cmdParam3)) {
			usage() // prints help and stops execution

		} else {
			let tmp = argvSwitch(params[i], cmdParam1) // returns "true", "false" or "undefined"
			if (tmp) { // correct parameter/switch:
				recursive = true
				params.splice(i, 1)

			} else if (tmp === false) { // invalid parameter/path:
				invalidParams.push({ type: invalidParamTypePath, value: params[i] })

			} else { // unknown parameter/switch:
				invalidParams.push({ type: invalidParamTypeSwitch, value: params[i] })
			}
		}
	}
	// check if all parameters were recognized:
	if (params.length === 0) {
		doLog(logLevelInfo, `look for files in folder '` + sourceDir + `' ` + ((recursive) ? `and` : `but not`) + ` in its sub-folders`)
		// make sure source directory exists:
		if (!pathExistsSync(sourceDir)) {
			throw new Error(`directory '` + sourceDir + `' doesn't exist`)
		}

		try {
			// make sure source directory is not empty:
			let files = readDirSync(sourceDir, recursive) // throws with message on error
			//doLog(logLevelFatal, JSON.stringify(files, null, '\t'))
			if ((!Array.isArray(files)) || (!files.length)) {
				throw new Error(`no files found in directory '` + sourceDir + `'`)
			}
			doLog(logLevelInfo, singularPlural(files.length, 'file')  + ` found`)

			//------------------------------------------------------------
			// find and mark or delete thumbnail files that also exist as originals:
			{ // keep "filesObj" local to save (a little bit) of memory:
				let filesObj = arrayToObject(files, 'name') // object, not array: for fast lookup
				for (let i = files.length - 1; i >= 0; i--) { // we work backwards, because we possibly delete from array
					let nameRed = files[i].name.replace(findOriginal.find, findOriginal.original)
					if ((nameRed !== files[i].name) && (filesObj[nameRed] !== undefined)) {
						if (configuration.deleteThumbnailIfOriginalExists) {
							try {
								fs.unlinkSync(files[i].fullname)
								doLog(logLevelDebug, `ok, could delete thumbnail file '` + files[i].fullname + `'; original '` + nameRed + `' exists`)
								files.splice(i, 1)

							} catch(err) {
								doLog(logLevelError, `could not delete thumbnail file '` + files[i].fullname + `'; ` + err)
							}

						} else {
							files[i].tmpName = findOriginal.found + files[i].name
							doLog(logLevelDebug, `ok, could mark thumbnail file '` + files[i].fullname + `'; original '` + nameRed + `' exists`)
						}

					} else {
						files[i].tmpName = files[i].name
					}
				}
			}

			//------------------------------------------------------------
			// select all csv files, they contain the information about posts and files:
			let csvFiles = files.filter(o => /csv/i.test(o.ext))
			doLog(logLevelInfo, singularPlural(csvFiles.length, ' CSV file')  + ` found`)
			//doLog(logLevelFatal, JSON.stringify(csvFiles, null, '\t'))

			//------------------------------------------------------------
			// collect all identities from contacts and groups:
			let identities = []
			//------------------------------------------------------------
			// extract all contacts:
			let contactFullnames = csvFiles.filter(o => o.name.toLowerCase() === specialFilenames.contacts).map(o => o.fullname)
			for (let contactFullname of contactFullnames) {
				identities = identities.concat((await getCsvFileAsJSON(contactFullname, false)).map(o => {
					let tokens = o.lastname.split(' ').concat(o.firstname.split(' ')).concat(o.nick_name.split(' ')).concat([o.identity])
					o.fullname = validPlatformName(tokens.filter((c, idx) => { // remove duplicate tokens:
						return tokens.map(s => s.toLowerCase()).indexOf(c.toLowerCase()) === idx
					}).join(' ').replace(/\s+/g, ' ').trim())
					return normalizeObj(o, contactCsvHeaders) // make sure object has exactly the keys in "contactCsvHeaders"
				}))
			}
			let identitiesLen = identities.length
			doLog(logLevelInfo, singularPlural(identitiesLen, 'contact')  + ` found`)

			//------------------------------------------------------------
			// extract all groups:
			let groupFullnames = csvFiles.filter(o => o.name.toLowerCase() === specialFilenames.groups).map(o => o.fullname)
			for (let groupFullname of groupFullnames) {
				identities = identities.concat((await getCsvFileAsJSON(groupFullname, false)).map(o => {
					o.identity = o.id + '-' + o.creator // that's how Threema uses group identifiers
					o.fullname = validPlatformName((o.groupname.trim()) ? o.groupname.trim() + ' ' + o.id : o.identity)
					return normalizeObj(o, groupCsvHeaders) // make sure object has exactly the keys in "groupCsvHeaders"
				}))
			}
			doLog(logLevelInfo, singularPlural(identities.length - identitiesLen, 'group')  + ` found`)

			//------------------------------------------------------------
			// keep all identities as object for fast lookup:
			if (identities.length) {
				identities = arrayToObject(identities, 'identity')

			} else {
				identities = {}
			}

			//------------------------------------------------------------
			let fileTimestamps = {}
			//------------------------------------------------------------
			// find identity behind conversation csv file, make sure corresponding sub-folder exists, and read all rows:
			for (let csv of csvFiles) {
				csv.identity = identityFromFilename(csv.name, identities)
				csv.nameExplicit = replaceNameParts(csv.name, identities, { includeReplaceParts: true, includeReplaceChars: false }) // performs "validPlatformName"
				csv.destDir = ensureTrailingSlash(sourceDir + csv.nameExplicit)
				if (skipFilenames.indexOf(csv.name) === -1) { // skip some of the csv files
					createDirSync(sourceDir + csv.nameExplicit)
					// read CSV rows, extend by Nodejs date objects:
					csv.rows = (await getCsvFileAsJSON(csv.fullname)).map(o => {
						// convert timestamps as long as "created_at" still exists:
						o.fileTimestamp = epochToLocal(o.created_at)
						o.fileTimestampISO = new Date(Number(o.created_at))
						// add timestamp for each non-text row:
						if (o.type.toLowerCase() !== 'text') {
							let ext = null
							if (o.body) {
								try {
									let tmp = JSON.parse(o.body.replace(/\\\\"/g, `'`)) // remove CSV escaping
									// Threema stores original filename at array position 4; mime type at array position 2, e.g. "application/octet-stream"
									if (Array.isArray(tmp) && (tmp.length >= 5) && (typeof tmp[4] === 'string')) {
										ext = tmp[4].split(`.`).pop()
									}

								} catch(err) {
									doLog(logLevelError, `could not convert body='` + o.body + `' to JSON (file='` + csv.name + `'); ` + err)
								}
							}

							if (fileTimestamps[o.uid] !== undefined) {
								doLog(logLevelFatal, `file timestamp collision; ` + o.uid + `; please report to ` + author)
							}
							fileTimestamps[o.uid] = {
								uid: o.uid,
								fileTimestamp: o.fileTimestamp,
								fileTimestampISO: o.fileTimestampISO,
								destDir: csv.destDir,
								ext: ext
							}
						}
						return normalizeObj(o, relevantHeaders) // make sure object has exactly the keys in "relevantHeaders"
					}) // all rows

					// get "interesting" text from every CSV row:
					csv.texts = []
					for (let i = 0; i < csv.rows.length; i++) {
						for (let s of textCsvHeaders) { // check all interesting columns for content:
							try {
								let tmp = JSON.parse(csv.rows[i][s]) // should not be successful, we are interested in texts not objects
								if (!Array.isArray(tmp)) { throw new Error('good!') }

							} catch(err) { // ends up here most of the times; every time it is really a text:
								if (csv.rows[i][s]) {
									let author = ((csv.rows[i].identity && identities[csv.rows[i].identity]) ? identities[csv.rows[i].identity].fullname : null)
									csv.texts.push(String(csv.rows[i].fileTimestampISO.getTime()).padStart(14, '0') + String(i).padStart(5, '0') + '\t[' + strftime(csv.rows[i].fileTimestampISO, configuration.textTimestampFormat) + '] ' + cleanText(csv.rows[i][s]) + ((author) ? ` [` + author + `]` : ``)) // keep the text
								}
							}
						}
					}
					csv.texts = csv.texts.sort().map(s => s.split('\t')[1]) // sort and remove sort string at beginning of strings

					// store texts as pure text file:
					if (csv.texts.length) {
						try {
							fs.writeFileSync(csv.destDir + configuration.saveMessagesTextsTo, csv.texts.join('\n'), 'utf8')

						} catch(err) {
							doLog(logLevelError, `could not write text file '` + csv.destDir + configuration.saveMessagesTextsTo + `'; ` + err)
						}
					}

				} else {
					csv.rows = []
					csv.texts = []
				}
			}
			//doLog(logLevelFatal, JSON.stringify(csvFiles, null, '\t'))
			//doLog(logLevelFatal, JSON.stringify(fileTimestamps, null, '\t'))

			//------------------------------------------------------------
			// all information is now ready; now, scan all media files, rename them, adjust their file timestamps and move them into the appropriate sub-folders:
			for (let file of files) {
				//------------------------------------------------------------
				// set default values for renamed/moved file and file timestamps:
				let dest = {
					dir: ensureTrailingSlash(file.dir),
					name: file.tmpName,
					ext: file.ext.replace(/^\.+/, '').toLowerCase() // remove dot from original extension because "file-type" returns ext without dot
				}

				//------------------------------------------------------------
				// determine file type:
				if ((dest.ext === 'csv') || (dest.ext === 'log') || (dest.ext === 'txt') || /identity/i.test(file.name) || /settings/i.test(file.name)) {
					dest.type = { ext: dest.ext } // store it in the way "file-type" does

				} else {
					dest.type = await fileType.fromFile(file.fullname) // may return null
				}

				//------------------------------------------------------------
				// don't process "csv" and "txt" filenames:
				if ((!/csv/.test(dest.ext)) && (!/txt/.test(dest.ext))) {
					// find timestamp that is contained as "uid" in the filename:
					let timestampPart
					let fileTimestamp = timestampFromFilename(file.name, fileTimestamps)
					if (fileTimestamp) { // use the data contained in the timestamp record to adjust the file information:
						dest.timestamp = fileTimestamp.fileTimestamp
						dest.timestampISO = fileTimestamp.fileTimestampISO
						dest.name = dest.name.replace(fileTimestamp.uid, '') // remove timestamp uid from filename
						dest.dir = fileTimestamp.destDir
						if ((!dest.type) && fileTimestamp.ext) {
							dest.type = { ext: fileTimestamp.ext }
						}
						// make timestamp part of filename and make sure it is not already contained:
						timestampPart = validPlatformName(strftime(dest.timestampISO, configuration.fileTimestampFormat) + ' ')
						while (dest.name.indexOf(timestampPart) !== -1) {
							dest.name = dest.name.replace(timestampPart, '')
						}
					}
					// find identity that is contained in the filename:
					let identity = identityFromFilename(file.name, identities)
					if (identity) {
						let i = csvFiles.map(o => ((o.identity) ? o.identity.identity : null)).indexOf(identity.identity)
						if (i !== -1) {
							dest.dir = csvFiles[i].destDir
							dest.name = dest.name.replace(identity.identity, '') // remove identity from filename
						}
					}
					// "purify" filename:
					dest.name = replaceNameParts(dest.name, identities, { includeReplaceParts: true, includeReplaceChars: true }) // includes "validPlatformName"
					// finally, add timestamp part to filename:
					if (timestampPart) {
						dest.name = timestampPart + dest.name
					}
					dest.name = dest.name.trim()
				}

				//------------------------------------------------------------
				// finally, get definitive new extension; including leading dot:
				if (dest.type) {
					dest.ext = dest.type.ext.toLowerCase()

				} else {
					doLog(logLevelError, `could not determine file type for file '` + file.fullname + `'`) // keep default value for extension
				}
				if (dest.ext) {
					dest.ext = '.' + dest.ext
				}

				//------------------------------------------------------------
				// rename file if new filename not equal to old name:
				dest.fullname = dest.dir + dest.name + dest.ext
				let n = 0
				if (dest.fullname !== normalizePath(file.fullname)) {
					try {
						while (pathExistsSync(dest.fullname)) { // rename file if same name already exists:
							dest.fullname = dest.dir + String(++n) + '_' + dest.name + dest.ext
						}
						//doLog(logLevelFatal, 'rename: ' + dest.fullname)
						fs.renameSync(file.fullname, dest.fullname) // rename and move
						doLog(logLevelDebug, `ok, could rename/move file '` + file.fullname + `' to '` + dest.fullname + `'`)

					} catch(err) {
						doLog(logLevelError, `could not rename file '` + file.fullname + `' to '` + dest.fullname + `'; ` + err)
						dest.fullname = file.fullname // new filename is still old filename; needed for adjusting file timetamps
					}

				} else {
					doLog(logLevelDebug, `file '` + file.fullname + `' does not need to be renamed`)
				}
				// create and store additional information to file if duplicates are to be removed:
				if (configuration.removeDuplicatesWithinFolder) {
					file.duplicateIdx = String(n).padStart(6, '0') + dest.name // artifical index, used to sort array of duplicates in the end
					file.destFullname = dest.fullname
					getHash(file, dest.fullname)
					//doLog(logLevelFatal, JSON.stringify(file))
				}

				//------------------------------------------------------------
				// set "last access" and "last modified" timestamps for file if known:
				if (dest.timestampISO) {
					try {
						fs.utimesSync(dest.fullname, dest.timestampISO, dest.timestampISO)
						doLog(logLevelDebug, `ok, could adjust file timestamps for file '` + dest.fullname + `'`)

					} catch(err) {
						doLog(logLevelError, `could not adjust file timestamps for file '` + dest.fullname + `'; ` + err)
					}
				}

			} // next "file of files"

			//------------------------------------------------------------
			let deleted = [] // we must keep track of deleted files; not only within the following block
			//------------------------------------------------------------
			// process all duplicates within a folder if requested:
			if (configuration.removeDuplicatesWithinFolder) {
				let struct = {}
				for (let file of files) {
					if (struct[file.pathHash] === undefined) {
						struct[file.pathHash] = [file] // each key of "struct" is an array of duplicates; minimum length = 1

					} else {
						struct[file.pathHash].push(file) // add file to array; is a real duplicate
					}
				}
				for (let node in struct) {
					if (struct[node].length > 1) {
						struct[node].sort(dynamicSort('duplicateIdx')) // sort array by ascending duplicate index; we will keep first one with lowest index
						for (let i = 1; i < struct[node].length; i++) { // keep only the file in the first array element:
							try {
								fs.unlinkSync(struct[node][i].destFullname)
								doLog(logLevelDebug, `ok, could delete duplicate file '` + struct[node][i].destFullname + `'`)
								deleted.push(struct[node][i].destFullname) // keep filnames that don't exist anymore
								//doLog(logLevelDebug, `delete duplicate '` + struct[node][i].destFullname + `' of '` + struct[node][0].destFullname + `'`)

							} catch(err) {
								doLog(logLevelError, `could not delete duplicate file '` + struct[node][i].destFullname + `'; ` + err)
							}
						}
					}
				}
			}

			//------------------------------------------------------------
			// save all duplicates if requested:
			if (configuration.saveDuplicateFileNamesTo) {
				let struct = {}
				for (let file of files) {
					// skip files that don't exist anymore:
					if (deleted.indexOf(file.destFullname) === -1) {
						if (struct[file.hash] === undefined) {
							struct[file.hash] = [file] // each key of "struct" is an array of duplicates; minimum length = 1

						} else {
							struct[file.hash].push(file) // add file to array; is a real duplicate
						}
					}
				}
				let fullnames = []
				for (let node in struct) {
					if (struct[node].length > 1) {
						struct[node].sort(dynamicSort('duplicateIdx')) // sort array by ascending duplicate index
						// add fullnames in block to array; add delimiter between blocks:
						fullnames = fullnames.concat(((fullnames.length) ? [''] /* delimiter */ : [])).concat(struct[node].map(o => o.destFullname))
					}
				}
				// save list of duplicates to file:
				let duplicatesFile = sourceDir + String(configuration.saveDuplicateFileNamesTo)
				try {
					fs.writeFileSync(duplicatesFile, fullnames.join('\n') || `[none]`, 'utf8')
					doLog(logLevelInfo, `ok, could save list of duplicates to file '` + duplicatesFile + `'`)

				} catch(err) {
					doLog(logLevelError, `could not save list of duplicates to file '` + duplicatesFile + `'; ` + err)
				}
			}

			//------------------------------------------------------------
			// finally, delete empty folders if requested:
			if (configuration.removeEmptyFolders) {
				readDirSync(sourceDir, true, undefined, true) // throws with message on error
			}

		} catch(err) {
			doLog(logLevelError, `something went wrong; ` + err)
		}

	// there was something wrong with the command line parameters:
	} else {
		if (invalidParams.length) {
			doLog(``, `-------------------------------------------------------------------------------`)
			let a = invalidParams.filter(o => o.type === invalidParamTypePath).map(o => `  '` + o.value + `'`)
			if (a.length) {
				doLog(``, `Path` + ((a.length > 1) ? `s` : ``) + ` not found:\n` + a.join('\n'))
			}
			a = invalidParams.filter(o => o.type === invalidParamTypeSwitch).map(o => `  '` + o.value + `'`)
			if (a.length) {
				doLog(``, `Invalid switch` + ((a.length > 1) ? `es` : ``) + `:\n` + a.join('\n'))
			}
		}
		usage()
	}
	if (globals.logFile) {
		doLog(logLevelInfo, `log written to file '` + globals.logFile + `'`)
	}
})()
