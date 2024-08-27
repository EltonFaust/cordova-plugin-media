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
    this.src = src;
    this.successCallback = successCallback;
    this.errorCallback = errorCallback;
    this.statusCallback = statusCallback;
    this.durationUpdateCallback = durationUpdateCallback;
    this.recorder = null;
    this._duration = -1;
    this._position = -1;

    try {
        this.node = createNode(this);
    } catch (err) {
        Media.onStatus(this.id, Media.MEDIA_ERROR, {
            code: MediaError.MEDIA_ERR_ABORTED
        });
    }
};

/**
 * Creates new Audio node and with necessary event listeners attached
 * @param  {Media} media Media object
 * @return {Audio}       Audio element
 */
function createNode (media) {
    var node = new Audio();

    node.onplay = function () {
        Media.onStatus(media.id, Media.MEDIA_STATE, Media.MEDIA_STARTING);
    };

    node.onplaying = function () {
        Media.onStatus(media.id, Media.MEDIA_STATE, Media.MEDIA_RUNNING);
    };

    node.ondurationchange = function (e) {
        Media.onStatus(media.id, Media.MEDIA_DURATION, e.target.duration || -1);
    };

    node.onerror = function (e) {
        // Due to media.spec.15 It should return MediaError for bad filename
        var err = e.target.error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ? { code: MediaError.MEDIA_ERR_ABORTED } : e.target.error;

        Media.onStatus(media.id, Media.MEDIA_ERROR, err);
    };

    node.onended = function () {
        Media.onStatus(media.id, Media.MEDIA_STATE, Media.MEDIA_STOPPED);
    };

    if (media.src) {
        node.src = media.src;
    }

    return node;
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
    if (!Media.playMode(this.id)) {
        return;
    }

    // if Media was released, then node will be null and we need to create it again
    if (!this.node) {
        try {
            this.node = createNode(this);
        } catch (err) {
            Media.onStatus(this.id, Media.MEDIA_ERROR, {
                code: MediaError.MEDIA_ERR_ABORTED
            });
        }
    } else if (this.src && (!this.node.src || this.node.src !== this.src)) {
        // changed de src value
        this.node.src = this.src;
        this.node.load();
    }

    this.node.play();
};

/**
 * Stop playing audio file.
 */
Media.prototype.stop = function () {
    if (!Media.playMode(this.id)) {
        return;
    }

    try {
        this.pause();
        this.seekTo(0);
        Media.onStatus(this.id, Media.MEDIA_STATE, Media.MEDIA_STOPPED);
    } catch (err) {
        Media.onStatus(this.id, Media.MEDIA_ERROR, err);
    }
};

/**
 * Seek or jump to a new time in the track..
 */
Media.prototype.seekTo = function (milliseconds) {
    if (!Media.playMode(this.id)) {
        return;
    }

    try {
        this.node.currentTime = milliseconds / 1000;
    } catch (err) {
        Media.onStatus(this.id, Media.MEDIA_ERROR, err);
    }
};

/**
 * Pause playing audio file.
 */
Media.prototype.pause = function () {
    if (!Media.playMode(this.id)) {
        return;
    }

    try {
        this.node.pause();
        Media.onStatus(this.id, Media.MEDIA_STATE, Media.MEDIA_PAUSED);
    } catch (err) {
        Media.onStatus(this.id, Media.MEDIA_ERROR, err);
    }
};

/**
 * Get duration of an audio file.
 * The duration is only set for audio that is playing, paused or stopped.
 *
 * @return      duration or -1 if not known.
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
                    Media.onStatus(_that.id, Media.MEDIA_STATE, Media.MEDIA_RUNNING);
                };

                recorder.onresume = function () {
                    Media.onStatus(_that.id, Media.MEDIA_STATE, Media.MEDIA_RUNNING);
                };

                recorder.onpause = function () {
                    Media.onStatus(_that.id, Media.MEDIA_STATE, Media.MEDIA_PAUSED);
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

                    _that.mode = Media.MODE_NONE;

                    Media.onStatus(_that.id, Media.MEDIA_STATE, Media.MEDIA_STOPPED);
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
    try {
        delete this.node;
    } catch (err) {
        Media.onStatus(this.id, Media.MEDIA_ERROR, err);
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
    this.node.volume = volume;
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

    if (media) {
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
    } else if (console.error) {
        console.error('Received Media.onStatus callback for unknown media :: ' + id);
    }
};

/**
 * Browser depends on `MediaRecorder` support
 */
Media.isRecordSupported = function () {
    return typeof window.navigator.mediaDevices !== 'undefined'
        && typeof window.navigator.mediaDevices.getUserMedia !== 'undefined';
};

/**
 * attempts to put the player in play mode
 * @return true if in playmode, false otherwise
 */
Media.playMode = function (id) {
    var media = mediaObjects[id];

    if (media) {
        switch (media.mode) {
        case Media.MODE_NONE:
            media.mode = Media.MODE_PLAY;
            return true;
        case Media.MODE_PLAY:
            return true;
        case Media.MODE_RECORD:
            Media.onStatus(id, Media.MEDIA_ERROR, {
                code: MediaError.MEDIA_ERR_ABORTED,
                message: 'Error: Can\'t play in record mode.',
            });
            return false;
        default:
            if (console.error) {
                console.error('Unhandled Media.playMode :: ' + media.mode);
            }
            break;
        }
    } else if (console.error) {
        console.error('Call Media.playMode for unknown media :: ' + id);
    }

    return false;
};

module.exports = Media;
