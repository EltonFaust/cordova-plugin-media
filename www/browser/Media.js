/*
 *
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 *
 */

/* global MediaError */

var argscheck = require('cordova/argscheck');
var utils = require('cordova/utils');

var mediaObjects = {};

/**
 * This class provides access to the device media, interfaces to both sound and video
 *
 * @constructor
 * @param src                   The file name or url to play
 * @param successCallback       The callback to be called when the file is done playing or recording.
 *                                  successCallback()
 * @param errorCallback         The callback to be called if there is an error.
 *                                  errorCallback(int errorCode) - OPTIONAL
 * @param statusCallback        The callback to be called when media status has changed.
 *                                  statusCallback(int statusCode) - OPTIONAL
 *
 * @param durationUpdateCallback  The callback to be called when the duration updates.
 *                                durationUpdateCallback(float duration) - OPTIONAL
 *
 */
var Media = function (src, successCallback, errorCallback, statusCallback, durationUpdateCallback) {
    argscheck.checkArgs('SFFFF', 'Media', arguments);
    this.id = utils.createUUID();
    mediaObjects[this.id] = this;
    this.mode = Media.MODE_NONE;
    this.state = Media.MEDIA_NONE;
    this.src = src;
    this.successCallback = successCallback;
    this.errorCallback = errorCallback;
    this.statusCallback = statusCallback;
    this.durationUpdateCallback = durationUpdateCallback;
    this.node = null;
    this.recorder = null;
    this._duration = -1;
    this._position = -1;
};

/**
 * Creates new Audio node and with necessary event listeners attached
 * @param  {Media} media Media object
 * @return {Audio}       Audio element
 */
function createNode (media) {
    var node = new Audio();

    node.onplaying = function () {
        setState(media, Media.MEDIA_RUNNING);
    };

    node.ondurationchange = function (e) {
        var duration = typeof e.target.duration === 'number' && Number.isFinite(e.target.duration) ? e.target.duration : -1;
        Media.onStatus(media.id, Media.MEDIA_DURATION, duration);
    };

    node.onerror = function (e) {
        // Due to media.spec.15 It should return MediaError for bad filename
        var err = e.target.error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ? { code: MediaError.MEDIA_ERR_ABORTED } : e.target.error;

        Media.onStatus(media.id, Media.MEDIA_ERROR, err);
    };

    node.onended = function () {
        setState(media, Media.MEDIA_STOPPED);
    };

    return node;
}

/**
 * Set the state and send it to JavaScript.
 *
 * @param state
 */
function setState(media, state) {
    if (media.state != state) {
        Media.onStatus(media.id, Media.MEDIA_STATE, state);
    }

    media.state = state;
}

/**
 * attempts to put the player in play mode
 * @return true if in playmode, false otherwise
 */
function playMode(media) {
    switch (media.mode) {
    case Media.MODE_NONE:
        media.mode = Media.MODE_PLAY;
        return true;
    case Media.MODE_PLAY:
        return true;
    case Media.MODE_RECORD:
        sendErrorStatus(media.id, MediaError.MEDIA_ERR_ABORTED, 'Error: Can\'t play in record mode.');
        return false;
    default:
        if (console.error) {
            console.error('Unhandled playMode :: ' + media.mode);
        }
        break;
    }

    return false;
}

/**
 * attempts to initialize the media player for playback
 * @return false if player not ready, reports if in wrong mode or state
 */
function readyPlayer(media, callback) {
    if (!playMode(media)) {
        return callback(false);
    }

    switch (media.state) {
    case Media.MEDIA_NONE:
        try {
            media.node = createNode(media);
        } catch (err) {
            sendErrorStatus(media.id, MediaError.MEDIA_ERR_ABORTED);
            return callback(false);
        }

        loadAudioFile(media, function (result) {
            if (result === true) {
                return callback(true)
            }

            sendErrorStatus(media.id, MediaError.MEDIA_ERR_ABORTED, result.message);
            return callback(false);
        });
        return;
    case Media.MEDIA_LOADING:
        return callback(false);
    case Media.MEDIA_STARTING:
    case Media.MEDIA_RUNNING:
    case Media.MEDIA_PAUSED:
        return callback(true);
    case Media.MEDIA_STOPPED:
        // check if the src was changed, if changed, recreate the node
        if (media.node && media.node.src != media.src) {
            media.node.pause();
            media.node = null;
            media.duration = -1;
        }

        if (media.node !== null) {
            return callback(true);
        }

        try {
            media.node = createNode(media);
        } catch (err) {
            sendErrorStatus(media.id, MediaError.MEDIA_ERR_ABORTED);
            return callback(false);
        }

        loadAudioFile(media, function (result) {
            if (result === true) {
                return callback(true)
            }

            sendErrorStatus(media.id, MediaError.MEDIA_ERR_ABORTED, result.message);
            return callback(false);
        });
        return;
    default:
        sendErrorStatus(media.id, MediaError.MEDIA_ERR_ABORTED, 'Error: readyPlayer() called during invalid state: ' + media.state);
    }
}

function loadAudioFile(media, callback) {
    if (!media.src) {
        return callback(new Error('Error: no source provided'));
    }

    var src = media.src;

    function nodeLoadSrc() {
        media.node.src = src;
        media.node.load();

        setState(media, Media.MEDIA_STARTING);

        callback(true);
    }

    // streaming url
    if (/^((http|https|rtsp|):\/\/|blob:)/.test(src) || src.indexOf('://') === -1) {
        return nodeLoadSrc();
    }

    try {
        // currently only available on chrome
        if (window.webkitRequestFileSystem && window.webkitResolveLocalFileSystemURL) {
            // if the plugin `cordova-plugin-file` is available, will try to save the file
            require('cordova-plugin-file.fileSystemPaths');
        } else {
            throw new Error('Error: browser not supported');
        }
    } catch (e) {
        return callback(e);
    }

    // resolve local file to a playable url
    window.resolveLocalFileSystemURL(
        src,
        function (fileEntry) {
            media.src = fileEntry.toURL();
            // force a query to reload local files, to prevent cache
            src = media.src + '?__t=' + Date.now();
            nodeLoadSrc();
        },
        function (e) {
            callback(e);
        }
    );
}

function sendErrorStatus(id, code, message) {
    Media.onStatus(id, Media.MEDIA_ERROR, {
        code: code,
        message: message,
    });
}

function hasBaseRecordSupport() {
    return typeof window.navigator.mediaDevices !== 'undefined' && typeof window.navigator.mediaDevices.getUserMedia !== 'undefined';
}

// Media messages
Media.MEDIA_STATE = 1;
Media.MEDIA_DURATION = 2;
Media.MEDIA_POSITION = 3;
Media.MEDIA_ERROR = 9;

// Media modes
Media.MODE_NONE = 0;
Media.MODE_PLAY = 1;
Media.MODE_RECORD = 2;

// Media states
Media.MEDIA_NONE = 0;
Media.MEDIA_STARTING = 1;
Media.MEDIA_RUNNING = 2;
Media.MEDIA_PAUSED = 3;
Media.MEDIA_STOPPED = 4;
Media.MEDIA_MSG = ['None', 'Starting', 'Running', 'Paused', 'Stopped'];

/**
 * Start or resume playing audio file.
 */
Media.prototype.play = function () {
    var media = this;

    readyPlayer(media, function (isReady) {
        if (!isReady) {
            return;
        }

        media.node.play();
    });
};

/**
 * Stop playing audio file.
 */
Media.prototype.stop = function () {
    if (this.node && (this.state === Media.MEDIA_RUNNING || this.state === Media.MEDIA_PAUSED)) {
        this.node.pause();
        this.node.currentTime = 0;
        setState(this, Media.MEDIA_STOPPED);
    } else {
        sendErrorStatus(this.id, MediaError.MEDIA_ERR_NONE_ACTIVE, 'Error: stop() called during invalid state: ' + this.state);
    }
};

/**
 * Seek or jump to a new time in the track..
 */
Media.prototype.seekTo = function (milliseconds) {
    var media = this;

    readyPlayer(media, function (isReady) {
        if (!isReady) {
            return;
        }

        try {
            var p = milliseconds / 1000;
            media.node.currentTime = p;
            Media.onStatus(media.id, Media.MEDIA_POSITION, p);
        } catch (err) {
            Media.onStatus(media.id, Media.MEDIA_ERROR, err);
        }
    });
};

/**
 * Pause playing audio file.
 */
Media.prototype.pause = function () {
    if (this.state === Media.MEDIA_RUNNING && this.node) {
        this.node.pause();
        setState(this, Media.MEDIA_PAUSED);
    } else {
        sendErrorStatus(this.id, MediaError.MEDIA_ERR_NONE_ACTIVE, 'Error: pause() called during invalid state: ' + this.state);
    }
};

/**
 * Get duration of an audio file.
 * The duration is only set for audio that is playing, paused or stopped.
 *
 * @return      duration or
 *                  -1=can't be determined
 *                  -2=not allowed
 */
Media.prototype.getDuration = function () {
    // Can't get duration of recording
    if (this.recorder !== null) {
        return -2;
    }

    return this._duration;
};

/**
 * Get position of audio.
 */
Media.prototype.getCurrentPosition = function (success, fail) {
    try {
        var p = this.node.currentTime;
        Media.onStatus(this.id, Media.MEDIA_POSITION, p);
        success(p);
    } catch (err) {
        fail(err);
    }
};

/**
 * Start recording audio file.
 */
Media.prototype.startRecord = function (options) {
    if (!hasBaseRecordSupport()) {
        sendErrorStatus(this.id, MediaError.MEDIA_ERR_ABORTED, 'Error: Record is not supported in this device.');
        return;
    }

    switch (this.mode) {
    case Media.MODE_PLAY:
        sendErrorStatus(this.id, MediaError.MEDIA_ERR_ABORTED, 'Error: Can\'t record in play mode.');
        break;
    case Media.MODE_NONE:
        var _that = this;
        var src = typeof this.src === 'string' && this.src.substr(0, 5) !== 'blob:' ? this.src : false;

        var fileSystemPaths;
        // fallback to blob? default is `true`
        var fileFallback = typeof options !== 'object' || !!options.fileFallback;

        try {
            // currently only available on chrome
            if (window.webkitRequestFileSystem && window.webkitResolveLocalFileSystemURL) {
                // if the plugin `cordova-plugin-file` is available, will try to save the file
                fileSystemPaths = require('cordova-plugin-file.fileSystemPaths').file;
            } else {
                fileSystemPaths = null;
            }
        } catch (e) {
            fileSystemPaths = null;
        }

        // disabled fallback to blob and filesystem record is not available or is not set a src (auto fallback to blob)
        if (!fileFallback && (!fileSystemPaths || !src)) {
            sendErrorStatus(this.id, MediaError.MEDIA_ERR_ABORTED, 'Error: Filesystem record not available and fallback disabled');
            return;
        }

        var recordFile;

        if (src) {
            if (fileSystemPaths) {
                // once is generated the url, it will be replaced the `file:///` with the a `cordova.file.applicationDirectory` (aka window.location.origin),
                // to be able to re-record, mantaining the original file name, replace back the string
                recordFile = src.replace(fileSystemPaths.applicationDirectory, 'file:///');
                // to support cdvfile: protocol
                recordFile = recordFile.replace('cdvfile://localhost/', 'filesystem:file://');
                // remove any query or hash from the url
                recordFile = recordFile.replace(/[?#].*$/, '');

                // only can save files to valid `temporary` and `persistent` directories
                if (recordFile.indexOf(':') !== -1 && recordFile.indexOf(fileSystemPaths.cacheDirectory) === -1 && recordFile.indexOf(fileSystemPaths.dataDirectory) === -1) {
                    sendErrorStatus(this.id, MediaError.MEDIA_ERR_ABORTED, 'Error: Resource for recording can only be saved at cordova.file.cacheDirectory or cordova.file.dataDirectory.');
                    return;
                }
            } else {
                recordFile = src;
            }
        } else {
            recordFile = false;
        }

        var useMimeType = this._recordFileMime;

        if (recordFile) {
            // get the mime based on the file extension
            var ext = recordFile.split('/').pop().split('.').slice(-2)[1] || '';

            switch (ext.toLowerCase()) {
            case 'webm':
                useMimeType = 'audio/webm';
                break;
            case 'mp4':
            case 'm4a':
                useMimeType = 'audio/mp4';
                break;
            case 'ogg':
                useMimeType = 'audio/ogg';
                break;
            case '':
                // no extension is provided
                useMimeType = this._recordFileMime || false;
                break;
            }

            if (useMimeType === false) {
                // no file extension, use de default, with `audio/webm` as priority
                if (window.MediaRecorder.isTypeSupported('audio/webm')) {
                    useMimeType = 'audio/webm';
                } else {
                    useMimeType = undefined;
                }
            } else if (!useMimeType) {
                sendErrorStatus(this.id, MediaError.MEDIA_ERR_ABORTED, 'Error: Resource for recording must have webm/mp4/m4a/ogg extension');
                return;
            } else if (!window.MediaRecorder.isTypeSupported(useMimeType)) {
                sendErrorStatus(this.id, MediaError.MEDIA_ERR_ABORTED, 'Error: Resource for recording with unavailable mime type: ' + useMimeType);
                return;
            }
        } else if (!useMimeType && window.MediaRecorder.isTypeSupported('audio/webm')) {
            // fallback to audio/webm
            useMimeType = 'audio/webm';
        }

        this._recordFileMime = useMimeType;

        // no url defined, src used only to determine mime type
        if (typeof recordFile !== 'string' || recordFile.indexOf(':') === -1) {
            recordFile = false;
        }

        window.navigator.mediaDevices.getUserMedia({ audio: true })
            .then(function (stream) {
                return new window.MediaRecorder(stream, { mimeType: useMimeType, audioBitsPerSecond: 96000 });
            }).then(function (recorder) {
                var chunks = [];

                recorder.ondataavailable = function (e) {
                    chunks.push(e.data);
                };

                recorder.onstart = function () {
                    setState(_that,  Media.MEDIA_RUNNING);
                };

                recorder.onresume = function () {
                    setState(_that,  Media.MEDIA_RUNNING);
                };

                recorder.onpause = function () {
                    setState(_that,  Media.MEDIA_PAUSED);
                };

                recorder.onstop = function () {
                    // no longer needed
                    recorder.stream.getTracks().forEach(function (track) {
                        if (track.readyState === 'live') {
                            track.stop();
                        }
                    });

                    // if was released there is no need to save the file
                    if (!_that.recorder) {
                        return;
                    }

                    var content = new Blob(chunks, { type: useMimeType });

                    function finish() {
                        _that._duration = -1;
                        _that._position = -1;
                        _that.recorder = null;

                        setState(_that, Media.MEDIA_STOPPED);

                        _that.mode = Media.MODE_NONE;
                        _that.state = Media.MEDIA_NONE;
                    }

                    function finishAsBlob() {
                        _that.src = window.URL.createObjectURL(content);
                        finish();
                    }

                    function finishAsBlobOrAbort(message) {
                        // if fallabck is disabled, send an abort error
                        if (!fileFallback) {
                            sendErrorStatus(_that.id, MediaError.MEDIA_ERR_ABORTED, 'Error: ' + message);
                            finish();
                            return;
                        }

                        if (console.warn) {
                            console.warn('Auto fallback to blob url: ' + message);
                        }

                        finishAsBlob();
                    }

                    // plugin `cordova-plugin-file` is not available, save as a `blob:` file
                    if (fileFallback && (!fileSystemPaths || !recordFile)) {
                        finishAsBlob();
                        return;
                    }

                    var localFileSystem = require('cordova-plugin-file.LocalFileSystem');
                    var useFileSystem = recordFile.indexOf(fileSystemPaths.cacheDirectory) !== -1 ? localFileSystem.TEMPORARY : localFileSystem.PERSISTENT;
                    var fileName = recordFile.substr(useFileSystem === localFileSystem.TEMPORARY ? fileSystemPaths.cacheDirectory.length -1 : fileSystemPaths.dataDirectory.length -1);

                    window.requestFileSystem(
                        useFileSystem, 0,
                        function (fs) {
                            fs.root.getFile(
                                fileName,
                                { create: true, exclusive: false },
                                function (fileEntry) {
                                    fileEntry.createWriter(function (fileWriter) {
                                        var truncated = false;

                                        fileWriter.onwriteend = function () {
                                            if (!truncated) {
                                                // now that is truncated, write the content
                                                truncated = true;
                                                fileWriter.write(content);
                                            } else {
                                                _that.src = fileEntry.toURL();
                                                finish();
                                            }
                                        };

                                        fileWriter.onerror = function (e) {
                                            finishAsBlobOrAbort('Failed to write file: ' + e.message);
                                        };

                                        // will truncate the file first (prevent re-write problems)
                                        fileWriter.seek(0);
                                        fileWriter.truncate(0);
                                    });
                                },
                                function (e) {
                                    finishAsBlobOrAbort('Failed to get file: ' + e.message);
                                }
                            );
                        },
                        function (e) {
                            finishAsBlobOrAbort('Failed to request file system: ' + e.message);
                        }
                    );
                };

                _that.mode = Media.MODE_RECORD;
                _that.recorder = recorder;
                _that.recorder.start();
            }).catch(function (e) {
                sendErrorStatus(_that.id, MediaError.MEDIA_ERR_ABORTED, 'Error: Can\'t start record. ' + e.message);
            });
        break;
    case Media.MODE_RECORD:
        sendErrorStatus(this.id, MediaError.MEDIA_ERR_ABORTED, 'Error: Already recording.');
    }
};

/**
 * Stop recording audio file.
 */
Media.prototype.stopRecord = function () {
    if (this.recorder) {
        this.recorder.stop();
    }
};

/**
 * Pause recording audio file.
 */
Media.prototype.pauseRecord = function () {
    if (this.recorder && this.recorder.state === 'recording') {
        this.recorder.pause();
    }
};

/**
 * Returns the current amplitude of the current recording.
 */
Media.prototype.getCurrentAmplitude = function () {
    Media.onStatus(this.id, Media.MEDIA_ERROR, 'Not supported');
};

/**
 * Resume recording an audio file.
 */
Media.prototype.resumeRecord = function () {
    if (this.recorder !== null) {
        this.recorder.resume();
    } else {
        this.startRecord();
    }
};

/**
 * Set rate of an autio file.
 */
Media.prototype.setRate = function () {
    Media.onStatus(this.id, Media.MEDIA_ERROR, 'Not supported');
};

/**
 * Release the resources.
 */
Media.prototype.release = function () {
    if (this.node) {
        this.node.pause();
        this.node = null;
    }

    if (this.recorder) {
        var _recorder = this.recorder;

        this.recorder = null;

        if (_recorder.state === 'recording') {
            _recorder.stop();
        }
    }
};

/**
 * Adjust the volume.
 */
Media.prototype.setVolume = function (volume) {
    if (this.node) {
        this.node.volume = volume;
    } else {
        Media.onStatus(this.id, Media.MEDIA_ERROR, {
            code: MediaError.MEDIA_ERR_NONE_ACTIVE,
            message: 'Error: Cannot set volume until the audio file is initialized.',
        });
    }
};

/**
 * Audio has status update.
 * PRIVATE
 *
 * @param id            The media object id (string)
 * @param msgType       The 'type' of update this is
 * @param value         Use of value is determined by the msgType
 */
Media.onStatus = function (id, msgType, value) {
    var media = mediaObjects[id];

    if (!media) {
        if (console.error) {
            console.error('Received Media.onStatus callback for unknown media :: ' + id);
        }

        return;
    }

    switch (msgType) {
    case Media.MEDIA_STATE:
        if (media.statusCallback) {
            media.statusCallback(value);
        }
        if (value === Media.MEDIA_STOPPED) {
            if (media.successCallback) {
                media.successCallback();
            }
        }
        break;
    case Media.MEDIA_DURATION:
        media._duration = value;
        if (media.durationUpdateCallback) {
            media.durationUpdateCallback(value);
        }
        break;
    case Media.MEDIA_ERROR:
        if (media.errorCallback) {
            media.errorCallback(value);
        }
        break;
    case Media.MEDIA_POSITION:
        media._position = Number(value);
        break;
    default:
        if (console.error) {
            console.error('Unhandled Media.onStatus :: ' + msgType);
        }
        break;
    }
};

/**
 * Browser depends on `MediaRecorder` support
 */
Media.isRecordSupported = function (win) {
    // check if the browser has the MediaRecord capability
    if (!hasBaseRecordSupport()) {
        setTimeout(function () {
            win(false);
        }, 0);

        return;
    }

    // check if there is any input device like an microphone
    window.navigator.mediaDevices.enumerateDevices()
        .then(function (devices) {
            return devices.filter(function (device) {
                return device.kind === 'audioinput';
            });
        })
        .then(function (audioDevices) {
            win(audioDevices.length > 0);
        });
};

module.exports = Media;
