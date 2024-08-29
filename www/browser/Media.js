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
    argscheck.checkArgs('SFFF', 'Media', arguments);
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
        sendErrorStatus(id, MediaError.MEDIA_ERR_ABORTED, 'Error: Can\'t play in record mode.');
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
function readyPlayer (media) {
    if (!playMode(media)) {
        return false;
    }

    switch (media.state) {
        case Media.MEDIA_NONE:
            try {
                media.node = createNode(media);
            } catch (err) {
                sendErrorStatus(id, MediaError.MEDIA_ERR_ABORTED);
                return false;
            }

            try {
                loadAudioFile(media);
            } catch (e) {
                sendErrorStatus(id, MediaError.MEDIA_ERR_ABORTED, e.message);
                return false;
            }

            return true;
        case Media.MEDIA_LOADING:
            return false;
        case Media.MEDIA_STARTING:
        case Media.MEDIA_RUNNING:
        case Media.MEDIA_PAUSED:
            return true;
        case Media.MEDIA_STOPPED:
            // check if the src was changed, if changed, recreate the node
            if (media.node && media.node.src != media.src) {
                media.node.pause();
                media.node = null;
                media.duration = -1;
            }

            if (media.node === null) {
                try {
                    media.node = createNode(media);
                } catch (err) {
                    sendErrorStatus(id, MediaError.MEDIA_ERR_ABORTED);
                    return false;
                }

                try {
                    loadAudioFile(media);
                } catch (e) {
                    sendErrorStatus(id, MediaError.MEDIA_ERR_ABORTED, e.message);
                    return false;
                }
            }

            return true;
        default:
            sendErrorStatus(id, MediaError.MEDIA_ERR_ABORTED, 'Error: readyPlayer() called during invalid state: ' + media.state);
    }
}

function loadAudioFile(media) {
    if (!media.src) {
        throw new Error('Error: no source provided');
    }

    media.node.src = media.src;
    media.node.load();

    setState(media, Media.MEDIA_STARTING);
}

function sendErrorStatus(id, code, message) {
    Media.onStatus(id, Media.MEDIA_ERROR, {
        code: code,
        message: message,
    });
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
    if (!readyPlayer(this)) {
        return;
    }

    this.node.play();
};

/**
 * Stop playing audio file.
 */
Media.prototype.stop = function () {
    if (
        this.node
        && (this.state === Media.MEDIA_RUNNING || this.state === Media.MEDIA_PAUSED)
    ) {
        this.node.pause();
        this.node.currentTime = 0;
        setState(this, Media.MEDIA_STOPPED);
    } else {
        Media.onStatus(this.id, Media.MEDIA_ERROR, {
            code: MediaError.MEDIA_ERR_NONE_ACTIVE,
            message: 'Error: stop() called during invalid state: ' + this.state,
        });
    }
};

/**
 * Seek or jump to a new time in the track..
 */
Media.prototype.seekTo = function (milliseconds) {
    if (!readyPlayer(this)) {
        return;
    }

    try {
        var p = milliseconds / 1000;
        this.node.currentTime = p;
        Media.onStatus(this.id, Media.MEDIA_POSITION, p);
    } catch (err) {
        Media.onStatus(this.id, Media.MEDIA_ERROR, err);
    }
};

/**
 * Pause playing audio file.
 */
Media.prototype.pause = function () {
    if (this.state === Media.MEDIA_RUNNING && this.node) {
        this.node.pause();
        setState(this, Media.MEDIA_PAUSED);
    } else {
        Media.onStatus(this.id, Media.MEDIA_ERROR, {
            code: MediaError.MEDIA_ERR_NONE_ACTIVE,
            message: 'Error: pause() called during invalid state: ' + this.state,
        });
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
Media.prototype.startRecord = function () {
    if (!Media.isRecordSupported()) {
        Media.onStatus(this.id, Media.MEDIA_ERROR, 'Not supported');
        return;
    }

    switch (this.mode) {
    case Media.MODE_PLAY:
        Media.onStatus(this.id, Media.MEDIA_ERROR, {
            code: MediaError.MEDIA_ERR_ABORTED,
            message: 'Error: Can\'t record in play mode.',
        });
        break;
    case Media.MODE_NONE:
        var _that = this;
        window.navigator.mediaDevices.getUserMedia({ audio: true })
            .then(function (stream) {
                return new MediaRecorder(stream, { /* mimeType: 'audio/webm', */ audioBitsPerSecond: 96000 })
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
                    if (_that.recorder) {
                        _that.src = URL.createObjectURL(new Blob(chunks, { /* type: 'audio/webm' */ }));
                        _that._duration = -1;
                        _that._position = -1;
                        _that.recorder = null;
                    }

                    // no longer needed
                    recorder.stream.getTracks().forEach(function (track) {
                        if (track.readyState === 'live') {
                            track.stop();
                        }
                    });

                    setState(_that, Media.MEDIA_STOPPED);

                    _that.mode = Media.MODE_NONE;
                    _that.state = Media.MEDIA_NONE;
                };

                _that.mode = Media.MODE_RECORD;
                _that.recorder = recorder;
                _that.recorder.start();
            }).catch(function (e) {
                Media.onStatus(_that.id, Media.MEDIA_ERROR, {
                    code: MediaError.MEDIA_ERR_ABORTED,
                    message: 'Error: Can\'t start record. ' + e.message,
                });
            });

        // sendErrorStatus(MEDIA_ERR_ABORTED, null);
        break;
    case Media.MODE_RECORD:
        Media.onStatus(this.id, Media.MEDIA_ERROR, {
            code: MediaError.MEDIA_ERR_ABORTED,
            message: 'Error: Already recording.',
        });
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

        delete this.recorder;

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
Media.isRecordSupported = function () {
    return typeof window.navigator.mediaDevices !== 'undefined'
        && typeof window.navigator.mediaDevices.getUserMedia !== 'undefined';
};

module.exports = Media;
