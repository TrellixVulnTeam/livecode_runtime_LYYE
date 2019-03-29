"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var file_system = require('../core/file_system');
var api_error_1 = require('../core/api_error');
var file_flag = require('../core/file_flag');
var preload_file = require('../generic/preload_file');
var path = require('path');
var MirrorFile = (function (_super) {
    __extends(MirrorFile, _super);
    function MirrorFile(fs, path, flag, stat, data) {
        _super.call(this, fs, path, flag, stat, data);
    }
    MirrorFile.prototype.syncSync = function () {
        if (this.isDirty()) {
            this._fs._syncSync(this);
            this.resetDirty();
        }
    };
    MirrorFile.prototype.closeSync = function () {
        this.syncSync();
    };
    return MirrorFile;
}(preload_file.PreloadFile));
var AsyncMirror = (function (_super) {
    __extends(AsyncMirror, _super);
    function AsyncMirror(sync, async) {
        _super.call(this);
        this._queue = [];
        this._queueRunning = false;
        this._isInitialized = false;
        this._initializeCallbacks = [];
        this._sync = sync;
        this._async = async;
        if (!sync.supportsSynch()) {
            throw new Error("Expected synchronous storage.");
        }
        if (async.supportsSynch()) {
            throw new Error("Expected asynchronous storage.");
        }
    }
    AsyncMirror.prototype.getName = function () {
        return "AsyncMirror";
    };
    AsyncMirror.isAvailable = function () {
        return true;
    };
    AsyncMirror.prototype._syncSync = function (fd) {
        this._sync.writeFileSync(fd.getPath(), fd.getBuffer(), null, file_flag.FileFlag.getFileFlag('w'), fd.getStats().mode);
        this.enqueueOp({
            apiMethod: 'writeFile',
            arguments: [fd.getPath(), fd.getBuffer(), null, fd.getFlag(), fd.getStats().mode]
        });
    };
    AsyncMirror.prototype.initialize = function (userCb) {
        var _this = this;
        var callbacks = this._initializeCallbacks;
        var end = function (e) {
            _this._isInitialized = !e;
            _this._initializeCallbacks = [];
            callbacks.forEach(function (cb) { return cb(e); });
        };
        if (!this._isInitialized) {
            if (callbacks.push(userCb) === 1) {
                var copyDirectory_1 = function (p, mode, cb) {
                    if (p !== '/') {
                        _this._sync.mkdirSync(p, mode);
                    }
                    _this._async.readdir(p, function (err, files) {
                        var i = 0;
                        function copyNextFile(err) {
                            if (err) {
                                cb(err);
                            }
                            else if (i < files.length) {
                                copyItem_1(path.join(p, files[i]), copyNextFile);
                                i++;
                            }
                            else {
                                cb();
                            }
                        }
                        if (err) {
                            cb(err);
                        }
                        else {
                            copyNextFile();
                        }
                    });
                }, copyFile_1 = function (p, mode, cb) {
                    _this._async.readFile(p, null, file_flag.FileFlag.getFileFlag('r'), function (err, data) {
                        if (err) {
                            cb(err);
                        }
                        else {
                            try {
                                _this._sync.writeFileSync(p, data, null, file_flag.FileFlag.getFileFlag('w'), mode);
                            }
                            catch (e) {
                                err = e;
                            }
                            finally {
                                cb(err);
                            }
                        }
                    });
                }, copyItem_1 = function (p, cb) {
                    _this._async.stat(p, false, function (err, stats) {
                        if (err) {
                            cb(err);
                        }
                        else if (stats.isDirectory()) {
                            copyDirectory_1(p, stats.mode, cb);
                        }
                        else {
                            copyFile_1(p, stats.mode, cb);
                        }
                    });
                };
                copyDirectory_1('/', 0, end);
            }
        }
        else {
            userCb();
        }
    };
    AsyncMirror.prototype.checkInitialized = function () {
        if (!this._isInitialized) {
            throw new api_error_1.ApiError(api_error_1.ErrorCode.EPERM, "AsyncMirrorFS is not initialized. Please initialize AsyncMirrorFS using its initialize() method before using it.");
        }
    };
    AsyncMirror.prototype.isReadOnly = function () { return false; };
    AsyncMirror.prototype.supportsSynch = function () { return true; };
    AsyncMirror.prototype.supportsLinks = function () { return false; };
    AsyncMirror.prototype.supportsProps = function () { return this._sync.supportsProps() && this._async.supportsProps(); };
    AsyncMirror.prototype.enqueueOp = function (op) {
        var _this = this;
        this._queue.push(op);
        if (!this._queueRunning) {
            this._queueRunning = true;
            var doNextOp = function (err) {
                if (err) {
                    console.error("WARNING: File system has desynchronized. Received following error: " + err + "\n$");
                }
                if (_this._queue.length > 0) {
                    var op = _this._queue.shift(), args = op.arguments;
                    args.push(doNextOp);
                    _this._async[op.apiMethod].apply(_this._async, args);
                }
                else {
                    _this._queueRunning = false;
                }
            };
            doNextOp();
        }
    };
    AsyncMirror.prototype.renameSync = function (oldPath, newPath) {
        this.checkInitialized();
        this._sync.renameSync(oldPath, newPath);
        this.enqueueOp({
            apiMethod: 'rename',
            arguments: [oldPath, newPath]
        });
    };
    AsyncMirror.prototype.statSync = function (p, isLstat) {
        this.checkInitialized();
        return this._sync.statSync(p, isLstat);
    };
    AsyncMirror.prototype.openSync = function (p, flag, mode) {
        this.checkInitialized();
        var fd = this._sync.openSync(p, flag, mode);
        fd.closeSync();
        return new MirrorFile(this, p, flag, this._sync.statSync(p, false), this._sync.readFileSync(p, null, file_flag.FileFlag.getFileFlag('r')));
    };
    AsyncMirror.prototype.unlinkSync = function (p) {
        this.checkInitialized();
        this._sync.unlinkSync(p);
        this.enqueueOp({
            apiMethod: 'unlink',
            arguments: [p]
        });
    };
    AsyncMirror.prototype.rmdirSync = function (p) {
        this.checkInitialized();
        this._sync.rmdirSync(p);
        this.enqueueOp({
            apiMethod: 'rmdir',
            arguments: [p]
        });
    };
    AsyncMirror.prototype.mkdirSync = function (p, mode) {
        this.checkInitialized();
        this._sync.mkdirSync(p, mode);
        this.enqueueOp({
            apiMethod: 'mkdir',
            arguments: [p, mode]
        });
    };
    AsyncMirror.prototype.readdirSync = function (p) {
        this.checkInitialized();
        return this._sync.readdirSync(p);
    };
    AsyncMirror.prototype.existsSync = function (p) {
        this.checkInitialized();
        return this._sync.existsSync(p);
    };
    AsyncMirror.prototype.chmodSync = function (p, isLchmod, mode) {
        this.checkInitialized();
        this._sync.chmodSync(p, isLchmod, mode);
        this.enqueueOp({
            apiMethod: 'chmod',
            arguments: [p, isLchmod, mode]
        });
    };
    AsyncMirror.prototype.chownSync = function (p, isLchown, uid, gid) {
        this.checkInitialized();
        this._sync.chownSync(p, isLchown, uid, gid);
        this.enqueueOp({
            apiMethod: 'chown',
            arguments: [p, isLchown, uid, gid]
        });
    };
    AsyncMirror.prototype.utimesSync = function (p, atime, mtime) {
        this.checkInitialized();
        this._sync.utimesSync(p, atime, mtime);
        this.enqueueOp({
            apiMethod: 'utimes',
            arguments: [p, atime, mtime]
        });
    };
    return AsyncMirror;
}(file_system.SynchronousFileSystem));
exports.__esModule = true;
exports["default"] = AsyncMirror;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQXN5bmNNaXJyb3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2VuZC9Bc3luY01pcnJvci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSxJQUFPLFdBQVcsV0FBVyxxQkFBcUIsQ0FBQyxDQUFDO0FBQ3BELDBCQUFrQyxtQkFBbUIsQ0FBQyxDQUFBO0FBQ3RELElBQU8sU0FBUyxXQUFXLG1CQUFtQixDQUFDLENBQUM7QUFHaEQsSUFBTyxZQUFZLFdBQVcseUJBQXlCLENBQUMsQ0FBQztBQUN6RCxJQUFZLElBQUksV0FBTSxNQUFNLENBQUMsQ0FBQTtBQVU3QjtJQUF5Qiw4QkFBcUM7SUFDNUQsb0JBQVksRUFBZSxFQUFFLElBQVksRUFBRSxJQUF3QixFQUFFLElBQVcsRUFBRSxJQUFZO1FBQzVGLGtCQUFNLEVBQUUsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsQ0FBQztJQUNwQyxDQUFDO0lBRU0sNkJBQVEsR0FBZjtRQUNFLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDLENBQUM7WUFDbkIsSUFBSSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDekIsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO1FBQ3BCLENBQUM7SUFDSCxDQUFDO0lBRU0sOEJBQVMsR0FBaEI7UUFDRSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7SUFDbEIsQ0FBQztJQUNILGlCQUFDO0FBQUQsQ0FBQyxBQWZELENBQXlCLFlBQVksQ0FBQyxXQUFXLEdBZWhEO0FBWUQ7SUFBeUMsK0JBQWlDO0lBVXhFLHFCQUFZLElBQTRCLEVBQUUsS0FBNkI7UUFDckUsaUJBQU8sQ0FBQztRQVBGLFdBQU0sR0FBc0IsRUFBRSxDQUFDO1FBQy9CLGtCQUFhLEdBQVksS0FBSyxDQUFDO1FBRy9CLG1CQUFjLEdBQVksS0FBSyxDQUFDO1FBQ2hD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WyJpbXBvcnQgZmlsZV9zeXN0ZW0gPSByZXF1aXJlKCcuLi9jb3JlL2ZpbGVfc3lzdGVtJyk7XG5pbXBvcnQge0FwaUVycm9yLCBFcnJvckNvZGV9IGZyb20gJy4uL2NvcmUvYXBpX2Vycm9yJztcbmltcG9ydCBmaWxlX2ZsYWcgPSByZXF1aXJlKCcuLi9jb3JlL2ZpbGVfZmxhZycpO1xuaW1wb3J0IGZpbGUgPSByZXF1aXJlKCcuLi9jb3JlL2ZpbGUnKTtcbmltcG9ydCBTdGF0cyBmcm9tICcuLi9jb3JlL25vZGVfZnNfc3RhdHMnO1xuaW1wb3J0IHByZWxvYWRfZmlsZSA9IHJlcXVpcmUoJy4uL2dlbmVyaWMvcHJlbG9hZF9maWxlJyk7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuXG5pbnRlcmZhY2UgSUFzeW5jT3BlcmF0aW9uIHtcblx0YXBpTWV0aG9kOiBzdHJpbmc7XG5cdGFyZ3VtZW50czogYW55W107XG59XG5cbi8qKlxuICogV2UgZGVmaW5lIG91ciBvd24gZmlsZSB0byBpbnRlcnBvc2Ugb24gc3luY1N5bmMoKSBmb3IgbWlycm9yaW5nIHB1cnBvc2VzLlxuICovXG5jbGFzcyBNaXJyb3JGaWxlIGV4dGVuZHMgcHJlbG9hZF9maWxlLlByZWxvYWRGaWxlPEFzeW5jTWlycm9yPiBpbXBsZW1lbnRzIGZpbGUuRmlsZSB7XG4gIGNvbnN0cnVjdG9yKGZzOiBBc3luY01pcnJvciwgcGF0aDogc3RyaW5nLCBmbGFnOiBmaWxlX2ZsYWcuRmlsZUZsYWcsIHN0YXQ6IFN0YXRzLCBkYXRhOiBCdWZmZXIpIHtcbiAgICBzdXBlcihmcywgcGF0aCwgZmxhZywgc3RhdCwgZGF0YSk7XG4gIH1cblxuICBwdWJsaWMgc3luY1N5bmMoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuaXNEaXJ0eSgpKSB7XG4gICAgICB0aGlzLl9mcy5fc3luY1N5bmModGhpcyk7XG4gICAgICB0aGlzLnJlc2V0RGlydHkoKTtcbiAgICB9XG4gIH1cblxuICBwdWJsaWMgY2xvc2VTeW5jKCk6IHZvaWQge1xuICAgIHRoaXMuc3luY1N5bmMoKTtcbiAgfVxufVxuXG4vKipcbiAqIEFzeW5jTWlycm9yRlMgbWlycm9ycyBhIHN5bmNocm9ub3VzIGZpbGVzeXN0ZW0gaW50byBhbiBhc3luY2hyb25vdXMgZmlsZXN5c3RlbVxuICogYnk6XG4gKiAqIFBlcmZvcm1pbmcgb3BlcmF0aW9ucyBvdmVyIHRoZSBpbi1tZW1vcnkgY29weSwgd2hpbGUgYXN5bmNocm9ub3VzbHkgcGlwZWxpbmluZyB0aGVtXG4gKiAgIHRvIHRoZSBiYWNraW5nIHN0b3JlLlxuICogKiBEdXJpbmcgYXBwbGljYXRpb24gbG9hZGluZywgdGhlIGNvbnRlbnRzIG9mIHRoZSBhc3luYyBmaWxlIHN5c3RlbSBjYW4gYmUgcmVsb2FkZWQgaW50b1xuICogICB0aGUgc3luY2hyb25vdXMgc3RvcmUsIGlmIGRlc2lyZWQuXG4gKiBUaGUgdHdvIHN0b3JlcyB3aWxsIGJlIGtlcHQgaW4gc3luYy4gVGhlIG1vc3QgY29tbW9uIHVzZS1jYXNlIGlzIHRvIHBhaXIgYSBzeW5jaHJvbm91c1xuICogaW4tbWVtb3J5IGZpbGVzeXN0ZW0gd2l0aCBhbiBhc3luY2hyb25vdXMgYmFja2luZyBzdG9yZS5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQXN5bmNNaXJyb3IgZXh0ZW5kcyBmaWxlX3N5c3RlbS5TeW5jaHJvbm91c0ZpbGVTeXN0ZW0gaW1wbGVtZW50cyBmaWxlX3N5c3RlbS5GaWxlU3lzdGVtIHtcbiAgLyoqXG4gICAqIFF1ZXVlIG9mIHBlbmRpbmcgYXN5bmNocm9ub3VzIG9wZXJhdGlvbnMuXG4gICAqL1xuICBwcml2YXRlIF9xdWV1ZTogSUFzeW5jT3BlcmF0aW9uW10gPSBbXTtcbiAgcHJpdmF0ZSBfcXVldWVSdW5uaW5nOiBib29sZWFuID0gZmFsc2U7XG4gIHByaXZhdGUgX3N5bmM6IGZpbGVfc3lzdGVtLkZpbGVTeXN0ZW07XG4gIHByaXZhdGUgX2FzeW5jOiBmaWxlX3N5c3RlbS5GaWxlU3lzdGVtO1xuICBwcml2YXRlIF9pc0luaXRpYWxpemVkOiBib29sZWFuID0gZmFsc2U7XG4gIHByaXZhdGUgX2luaXRpYWxpemVDYWxsYmFja3M6ICgoZT86IEFwaUVycm9yKSA9PiB2b2lkKVtdID0gW107XG4gIGNvbnN0cnVjdG9yKHN5bmM6IGZpbGVfc3lzdGVtLkZpbGVTeXN0ZW0sIGFzeW5jOiBmaWxlX3N5c3RlbS5GaWxlU3lzdGVtKSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLl9zeW5jID0gc3luYztcbiAgICB0aGlzLl9hc3luYyA9IGFzeW5jO1xuICAgIGlmICghc3luYy5zdXBwb3J0c1N5bmNoKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIHN5bmNocm9ub3VzIHN0b3JhZ2UuXCIpO1xuICAgIH1cbiAgICBpZiAoYXN5bmMuc3VwcG9ydHNTeW5jaCgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBhc3luY2hyb25vdXMgc3RvcmFnZS5cIik7XG4gICAgfVxuICB9XG5cbiAgcHVibGljIGdldE5hbWUoKTogc3RyaW5nIHtcblx0IFx0cmV0dXJuIFwiQXN5bmNNaXJyb3JcIjtcbiAgfVxuXG4gIHB1YmxpYyBzdGF0aWMgaXNBdmFpbGFibGUoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBwdWJsaWMgX3N5bmNTeW5jKGZkOiBwcmVsb2FkX2ZpbGUuUHJlbG9hZEZpbGU8YW55Pikge1xuICAgIHRoaXMuX3N5bmMud3JpdGVGaWxlU3luYyhmZC5nZXRQYXRoKCksIGZkLmdldEJ1ZmZlcigpLCBudWxsLCBmaWxlX2ZsYWcuRmlsZUZsYWcuZ2V0RmlsZUZsYWcoJ3cnKSwgZmQuZ2V0U3RhdHMoKS5tb2RlKTtcbiAgICB0aGlzLmVucXVldWVPcCh7XG4gICAgICBhcGlNZXRob2Q6ICd3cml0ZUZpbGUnLFxuICAgICAgYXJndW1lbnRzOiBbZmQuZ2V0UGF0aCgpLCBmZC5nZXRCdWZmZXIoKSwgbnVsbCwgZmQuZ2V0RmxhZygpLCBmZC5nZXRTdGF0cygpLm1vZGVdXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQ2FsbGVkIG9uY2UgdG8gbG9hZCB1cCBmaWxlcyBmcm9tIGFzeW5jIHN0b3JhZ2UgaW50byBzeW5jIHN0b3JhZ2UuXG4gICAqL1xuICBwdWJsaWMgaW5pdGlhbGl6ZSh1c2VyQ2I6IChlcnI/OiBBcGlFcnJvcikgPT4gdm9pZCk6IHZvaWQge1xuICAgIGNvbnN0IGNhbGxiYWNrcyA9IHRoaXMuX2luaXRpYWxpemVDYWxsYmFja3M7XG5cbiAgICBjb25zdCBlbmQgPSAoZT86IEFwaUVycm9yKTogdm9pZCA9PiB7XG4gICAgICB0aGlzLl9pc0luaXRpYWxpemVkID0gIWU7XG4gICAgICB0aGlzLl9pbml0aWFsaXplQ2FsbGJhY2tzID0gW107XG4gICAgICBjYWxsYmFja3MuZm9yRWFjaCgoY2IpID0+IGNiKGUpKTtcbiAgICB9O1xuXG4gICAgaWYgKCF0aGlzLl9pc0luaXRpYWxpemVkKSB7XG4gICAgICAvLyBGaXJzdCBjYWxsIHRyaWdnZXJzIGluaXRpYWxpemF0aW9uLCB0aGUgcmVzdCB3YWl0LlxuICAgICAgaWYgKGNhbGxiYWNrcy5wdXNoKHVzZXJDYikgPT09IDEpIHtcbiAgICAgICAgY29uc3QgY29weURpcmVjdG9yeSA9IChwOiBzdHJpbmcsIG1vZGU6IG51bWJlciwgY2I6IChlcnI/OiBBcGlFcnJvcikgPT4gdm9pZCkgPT4ge1xuICAgICAgICAgIGlmIChwICE9PSAnLycpIHtcbiAgICAgICAgICAgIHRoaXMuX3N5bmMubWtkaXJTeW5jKHAsIG1vZGUpO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLl9hc3luYy5yZWFkZGlyKHAsIChlcnIsIGZpbGVzKSA9PiB7XG4gICAgICAgICAgICB2YXIgaSA9IDA7XG4gICAgICAgICAgICAvLyBOT1RFOiBUaGlzIGZ1bmN0aW9uIG11c3Qgbm90IGJlIGluIGEgbGV4aWNhbGx5IG5lc3RlZCBzdGF0ZW1lbnQsXG4gICAgICAgICAgICAvLyBzdWNoIGFzIGFuIGlmIG9yIHdoaWxlIHN0YXRlbWVudC4gU2FmYXJpIHJlZnVzZXMgdG8gcnVuIHRoZVxuICAgICAgICAgICAgLy8gc2NyaXB0IHNpbmNlIGl0IGlzIHVuZGVmaW5lZCBiZWhhdmlvci5cbiAgICAgICAgICAgIGZ1bmN0aW9uIGNvcHlOZXh0RmlsZShlcnI/OiBBcGlFcnJvcikge1xuICAgICAgICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgY2IoZXJyKTtcbiAgICAgICAgICAgICAgfSBlbHNlIGlmIChpIDwgZmlsZXMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgY29weUl0ZW0ocGF0aC5qb2luKHAsIGZpbGVzW2ldKSwgY29weU5leHRGaWxlKTtcbiAgICAgICAgICAgICAgICBpKys7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgY2IoKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgICBjYihlcnIpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgY29weU5leHRGaWxlKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0sIGNvcHlGaWxlID0gKHA6IHN0cmluZywgbW9kZTogbnVtYmVyLCBjYjogKGVycj86IEFwaUVycm9yKSA9PiB2b2lkKSA9PiB7XG4gICAgICAgICAgdGhpcy5fYXN5bmMucmVhZEZpbGUocCwgbnVsbCwgZmlsZV9mbGFnLkZpbGVGbGFnLmdldEZpbGVGbGFnKCdyJyksIChlcnIsIGRhdGEpID0+IHtcbiAgICAgICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICAgICAgY2IoZXJyKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fc3luYy53cml0ZUZpbGVTeW5jKHAsIGRhdGEsIG51bGwsIGZpbGVfZmxhZy5GaWxlRmxhZy5nZXRGaWxlRmxhZygndycpLCBtb2RlKTtcbiAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIGVyciA9IGU7XG4gICAgICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICAgICAgY2IoZXJyKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9LCBjb3B5SXRlbSA9IChwOiBzdHJpbmcsIGNiOiAoZXJyPzogQXBpRXJyb3IpID0+IHZvaWQpID0+IHtcbiAgICAgICAgICB0aGlzLl9hc3luYy5zdGF0KHAsIGZhbHNlLCAoZXJyLCBzdGF0cykgPT4ge1xuICAgICAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgICBjYihlcnIpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChzdGF0cy5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgICAgICAgIGNvcHlEaXJlY3RvcnkocCwgc3RhdHMubW9kZSwgY2IpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgY29weUZpbGUocCwgc3RhdHMubW9kZSwgY2IpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9O1xuICAgICAgICBjb3B5RGlyZWN0b3J5KCcvJywgMCwgZW5kKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdXNlckNiKCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBjaGVja0luaXRpYWxpemVkKCk6IHZvaWQge1xuICAgIGlmICghdGhpcy5faXNJbml0aWFsaXplZCkge1xuICAgICAgdGhyb3cgbmV3IEFwaUVycm9yKEVycm9yQ29kZS5FUEVSTSwgXCJBc3luY01pcnJvckZTIGlzIG5vdCBpbml0aWFsaXplZC4gUGxlYXNlIGluaXRpYWxpemUgQXN5bmNNaXJyb3JGUyB1c2luZyBpdHMgaW5pdGlhbGl6ZSgpIG1ldGhvZCBiZWZvcmUgdXNpbmcgaXQuXCIpO1xuICAgIH1cbiAgfVxuXG4gIHB1YmxpYyBpc1JlYWRPbmx5KCk6IGJvb2xlYW4geyByZXR1cm4gZmFsc2U7IH1cbiAgcHVibGljIHN1cHBvcnRzU3luY2goKTogYm9vbGVhbiB7IHJldHVybiB0cnVlOyB9XG4gIHB1YmxpYyBzdXBwb3J0c0xpbmtzKCk6IGJvb2xlYW4geyByZXR1cm4gZmFsc2U7IH1cbiAgcHVibGljIHN1cHBvcnRzUHJvcHMoKTogYm9vbGVhbiB7IHJldHVybiB0aGlzLl9zeW5jLnN1cHBvcnRzUHJvcHMoKSAmJiB0aGlzLl9hc3luYy5zdXBwb3J0c1Byb3BzKCk7IH1cblxuICBwcml2YXRlIGVucXVldWVPcChvcDogSUFzeW5jT3BlcmF0aW9uKSB7XG4gICAgdGhpcy5fcXVldWUucHVzaChvcCk7XG4gICAgaWYgKCF0aGlzLl9xdWV1ZVJ1bm5pbmcpIHtcbiAgICAgIHRoaXMuX3F1ZXVlUnVubmluZyA9IHRydWU7XG4gICAgICB2YXIgZG9OZXh0T3AgPSAoZXJyPzogQXBpRXJyb3IpID0+IHtcbiAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFdBUk5JTkc6IEZpbGUgc3lzdGVtIGhhcyBkZXN5bmNocm9uaXplZC4gUmVjZWl2ZWQgZm9sbG93aW5nIGVycm9yOiAke2Vycn1cXG4kYCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMuX3F1ZXVlLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICB2YXIgb3AgPSB0aGlzLl9xdWV1ZS5zaGlmdCgpLFxuICAgICAgICAgICAgYXJncyA9IG9wLmFyZ3VtZW50cztcbiAgICAgICAgICBhcmdzLnB1c2goZG9OZXh0T3ApO1xuICAgICAgICAgICg8RnVuY3Rpb24+ICg8YW55PiB0aGlzLl9hc3luYylbb3AuYXBpTWV0aG9kXSkuYXBwbHkodGhpcy5fYXN5bmMsIGFyZ3MpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMuX3F1ZXVlUnVubmluZyA9IGZhbHNlO1xuICAgICAgICB9XG4gICAgICB9O1xuICAgICAgZG9OZXh0T3AoKTtcbiAgICB9XG4gIH1cblxuICBwdWJsaWMgcmVuYW1lU3luYyhvbGRQYXRoOiBzdHJpbmcsIG5ld1BhdGg6IHN0cmluZyk6IHZvaWQge1xuICAgIHRoaXMuY2hlY2tJbml0aWFsaXplZCgpO1xuICAgIHRoaXMuX3N5bmMucmVuYW1lU3luYyhvbGRQYXRoLCBuZXdQYXRoKTtcbiAgICB0aGlzLmVucXVldWVPcCh7XG4gICAgICBhcGlNZXRob2Q6ICdyZW5hbWUnLFxuICAgICAgYXJndW1lbnRzOiBbb2xkUGF0aCwgbmV3UGF0aF1cbiAgICB9KTtcbiAgfVxuICBwdWJsaWMgc3RhdFN5bmMocDogc3RyaW5nLCBpc0xzdGF0OiBib29sZWFuKTogU3RhdHMge1xuICAgIHRoaXMuY2hlY2tJbml0aWFsaXplZCgpO1xuICAgIHJldHVybiB0aGlzLl9zeW5jLnN0YXRTeW5jKHAsIGlzTHN0YXQpO1xuICB9XG4gIHB1YmxpYyBvcGVuU3luYyhwOiBzdHJpbmcsIGZsYWc6IGZpbGVfZmxhZy5GaWxlRmxhZywgbW9kZTogbnVtYmVyKTogZmlsZS5GaWxlIHtcbiAgICB0aGlzLmNoZWNrSW5pdGlhbGl6ZWQoKTtcbiAgICAvLyBTYW5pdHkgY2hlY2s6IElzIHRoaXMgb3Blbi9jbG9zZSBwZXJtaXR0ZWQ/XG4gICAgdmFyIGZkID0gdGhpcy5fc3luYy5vcGVuU3luYyhwLCBmbGFnLCBtb2RlKTtcbiAgICBmZC5jbG9zZVN5bmMoKTtcbiAgICByZXR1cm4gbmV3IE1pcnJvckZpbGUodGhpcywgcCwgZmxhZywgdGhpcy5fc3luYy5zdGF0U3luYyhwLCBmYWxzZSksIHRoaXMuX3N5bmMucmVhZEZpbGVTeW5jKHAsIG51bGwsIGZpbGVfZmxhZy5GaWxlRmxhZy5nZXRGaWxlRmxhZygncicpKSk7XG4gIH1cbiAgcHVibGljIHVubGlua1N5bmMocDogc3RyaW5nKTogdm9pZCB7XG4gICAgdGhpcy5jaGVja0luaXRpYWxpemVkKCk7XG4gICAgdGhpcy5fc3luYy51bmxpbmtTeW5jKHApO1xuICAgIHRoaXMuZW5xdWV1ZU9wKHtcbiAgICAgIGFwaU1ldGhvZDogJ3VubGluaycsXG4gICAgICBhcmd1bWVudHM6IFtwXVxuICAgIH0pO1xuICB9XG4gIHB1YmxpYyBybWRpclN5bmMocDogc3RyaW5nKTogdm9pZCB7XG4gICAgdGhpcy5jaGVja0luaXRpYWxpemVkKCk7XG4gICAgdGhpcy5fc3luYy5ybWRpclN5bmMocCk7XG4gICAgdGhpcy5lbnF1ZXVlT3Aoe1xuICAgICAgYXBpTWV0aG9kOiAncm1kaXInLFxuICAgICAgYXJndW1lbnRzOiBbcF1cbiAgICB9KTtcbiAgfVxuICBwdWJsaWMgbWtkaXJTeW5jKHA6IHN0cmluZywgbW9kZTogbnVtYmVyKTogdm9pZCB7XG4gICAgdGhpcy5jaGVja0luaXRpYWxpemVkKCk7XG4gICAgdGhpcy5fc3luYy5ta2RpclN5bmMocCwgbW9kZSk7XG4gICAgdGhpcy5lbnF1ZXVlT3Aoe1xuICAgICAgYXBpTWV0aG9kOiAnbWtkaXInLFxuICAgICAgYXJndW1lbnRzOiBbcCwgbW9kZV1cbiAgICB9KTtcbiAgfVxuICBwdWJsaWMgcmVhZGRpclN5bmMocDogc3RyaW5nKTogc3RyaW5nW10ge1xuICAgIHRoaXMuY2hlY2tJbml0aWFsaXplZCgpO1xuICAgIHJldHVybiB0aGlzLl9zeW5jLnJlYWRkaXJTeW5jKHApO1xuICB9XG4gIHB1YmxpYyBleGlzdHNTeW5jKHA6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIHRoaXMuY2hlY2tJbml0aWFsaXplZCgpO1xuICAgIHJldHVybiB0aGlzLl9zeW5jLmV4aXN0c1N5bmMocCk7XG4gIH1cbiAgcHVibGljIGNobW9kU3luYyhwOiBzdHJpbmcsIGlzTGNobW9kOiBib29sZWFuLCBtb2RlOiBudW1iZXIpOiB2b2lkIHtcbiAgICB0aGlzLmNoZWNrSW5pdGlhbGl6ZWQoKTtcbiAgICB0aGlzLl9zeW5jLmNobW9kU3luYyhwLCBpc0xjaG1vZCwgbW9kZSk7XG4gICAgdGhpcy5lbnF1ZXVlT3Aoe1xuICAgICAgYXBpTWV0aG9kOiAnY2htb2QnLFxuICAgICAgYXJndW1lbnRzOiBbcCwgaXNMY2htb2QsIG1vZGVdXG4gICAgfSk7XG4gIH1cbiAgcHVibGljIGNob3duU3luYyhwOiBzdHJpbmcsIGlzTGNob3duOiBib29sZWFuLCB1aWQ6IG51bWJlciwgZ2lkOiBudW1iZXIpOiB2b2lkIHtcbiAgICB0aGlzLmNoZWNrSW5pdGlhbGl6ZWQoKTtcbiAgICB0aGlzLl9zeW5jLmNob3duU3luYyhwLCBpc0xjaG93biwgdWlkLCBnaWQpO1xuICAgIHRoaXMuZW5xdWV1ZU9wKHtcbiAgICAgIGFwaU1ldGhvZDogJ2Nob3duJyxcbiAgICAgIGFyZ3VtZW50czogW3AsIGlzTGNob3duLCB1aWQsIGdpZF1cbiAgICB9KTtcbiAgfVxuICBwdWJsaWMgdXRpbWVzU3luYyhwOiBzdHJpbmcsIGF0aW1lOiBEYXRlLCBtdGltZTogRGF0ZSk6IHZvaWQge1xuICAgIHRoaXMuY2hlY2tJbml0aWFsaXplZCgpO1xuICAgIHRoaXMuX3N5bmMudXRpbWVzU3luYyhwLCBhdGltZSwgbXRpbWUpO1xuICAgIHRoaXMuZW5xdWV1ZU9wKHtcbiAgICAgIGFwaU1ldGhvZDogJ3V0aW1lcycsXG4gICAgICBhcmd1bWVudHM6IFtwLCBhdGltZSwgbXRpbWVdXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==