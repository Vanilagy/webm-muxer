"use strict";
var WebMMuxer = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __pow = Math.pow;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/main.ts
  var main_exports = {};
  __export(main_exports, {
    default: () => main_default
  });

  // src/ebml.ts
  var EBMLFloat32 = class {
    constructor(value) {
      this.value = value;
    }
  };
  var EBMLFloat64 = class {
    constructor(value) {
      this.value = value;
    }
  };

  // src/write_target.ts
  var WriteTarget = class {
    constructor() {
      this.pos = 0;
      this.helper = new Uint8Array(8);
      this.helperView = new DataView(this.helper.buffer);
      this.offsets = /* @__PURE__ */ new WeakMap();
      this.dataOffsets = /* @__PURE__ */ new WeakMap();
    }
    writeFloat32(value) {
      this.helperView.setFloat32(0, value, false);
      this.write(this.helper.subarray(0, 4));
    }
    writeFloat64(value) {
      this.helperView.setFloat64(0, value, false);
      this.write(this.helper);
    }
    writeUnsignedInt(value, width = measureUnsignedInt(value)) {
      let pos = 0;
      switch (width) {
        case 6:
          this.helperView.setUint8(pos++, value / __pow(2, 40) | 0);
        case 5:
          this.helperView.setUint8(pos++, value / __pow(2, 32) | 0);
        case 4:
          this.helperView.setUint8(pos++, value >> 24);
        case 3:
          this.helperView.setUint8(pos++, value >> 16);
        case 2:
          this.helperView.setUint8(pos++, value >> 8);
        case 1:
          this.helperView.setUint8(pos++, value);
          break;
        default:
          throw new Error("Bad UINT size " + width);
      }
      this.write(this.helper.subarray(0, pos));
    }
    writeEBMLVarInt(value, width = measureEBMLVarInt(value)) {
      let pos = 0;
      switch (width) {
        case 1:
          this.helperView.setUint8(pos++, 1 << 7 | value);
          break;
        case 2:
          this.helperView.setUint8(pos++, 1 << 6 | value >> 8);
          this.helperView.setUint8(pos++, value);
          break;
        case 3:
          this.helperView.setUint8(pos++, 1 << 5 | value >> 16);
          this.helperView.setUint8(pos++, value >> 8);
          this.helperView.setUint8(pos++, value);
          break;
        case 4:
          this.helperView.setUint8(pos++, 1 << 4 | value >> 24);
          this.helperView.setUint8(pos++, value >> 16);
          this.helperView.setUint8(pos++, value >> 8);
          this.helperView.setUint8(pos++, value);
          break;
        case 5:
          this.helperView.setUint8(pos++, 1 << 3 | value / __pow(2, 32) & 7);
          this.helperView.setUint8(pos++, value >> 24);
          this.helperView.setUint8(pos++, value >> 16);
          this.helperView.setUint8(pos++, value >> 8);
          this.helperView.setUint8(pos++, value);
          break;
        case 6:
          this.helperView.setUint8(pos++, 1 << 2 | value / __pow(2, 40) & 3);
          this.helperView.setUint8(pos++, value / __pow(2, 32) | 0);
          this.helperView.setUint8(pos++, value >> 24);
          this.helperView.setUint8(pos++, value >> 16);
          this.helperView.setUint8(pos++, value >> 8);
          this.helperView.setUint8(pos++, value);
          break;
        default:
          throw new Error("Bad EBML VINT size " + width);
      }
      this.write(this.helper.subarray(0, pos));
    }
    writeString(str) {
      this.write(new Uint8Array(str.split("").map((x) => x.charCodeAt(0))));
    }
    writeEBML(data) {
      var _a, _b;
      if (data instanceof Uint8Array) {
        this.write(data);
      } else if (Array.isArray(data)) {
        for (let elem of data) {
          this.writeEBML(elem);
        }
      } else {
        this.offsets.set(data, this.pos);
        this.writeUnsignedInt(data.id);
        if (Array.isArray(data.data)) {
          let sizePos = this.pos;
          let sizeSize = (_a = data.size) != null ? _a : 4;
          this.seek(this.pos + sizeSize);
          let startPos = this.pos;
          this.dataOffsets.set(data, startPos);
          this.writeEBML(data.data);
          let size = this.pos - startPos;
          let endPos = this.pos;
          this.seek(sizePos);
          this.writeEBMLVarInt(size, sizeSize);
          this.seek(endPos);
        } else if (typeof data.data === "number") {
          let size = (_b = data.size) != null ? _b : measureUnsignedInt(data.data);
          this.writeEBMLVarInt(size);
          this.writeUnsignedInt(data.data, size);
        } else if (typeof data.data === "string") {
          this.writeEBMLVarInt(data.data.length);
          this.writeString(data.data);
        } else if (data.data instanceof Uint8Array) {
          this.writeEBMLVarInt(data.data.byteLength, data.size);
          this.write(data.data);
        } else if (data.data instanceof EBMLFloat32) {
          this.writeEBMLVarInt(4);
          this.writeFloat32(data.data.value);
        } else if (data.data instanceof EBMLFloat64) {
          this.writeEBMLVarInt(8);
          this.writeFloat64(data.data.value);
        }
      }
    }
  };
  var measureUnsignedInt = (value) => {
    if (value < 1 << 8) {
      return 1;
    } else if (value < 1 << 16) {
      return 2;
    } else if (value < 1 << 24) {
      return 3;
    } else if (value < __pow(2, 32)) {
      return 4;
    } else if (value < __pow(2, 40)) {
      return 5;
    } else {
      return 6;
    }
  };
  var measureEBMLVarInt = (value) => {
    if (value < (1 << 7) - 1) {
      return 1;
    } else if (value < (1 << 14) - 1) {
      return 2;
    } else if (value < (1 << 21) - 1) {
      return 3;
    } else if (value < (1 << 28) - 1) {
      return 4;
    } else if (value < __pow(2, 35) - 1) {
      return 5;
    } else if (value < __pow(2, 42) - 1) {
      return 6;
    } else {
      throw new Error("EBML VINT size not supported " + value);
    }
  };
  var ArrayBufferWriteTarget = class extends WriteTarget {
    constructor() {
      super();
      this.buffer = new ArrayBuffer(__pow(2, 16));
      this.bytes = new Uint8Array(this.buffer);
    }
    ensureSize(size) {
      let newLength = this.buffer.byteLength;
      while (newLength < size)
        newLength *= 2;
      if (newLength === this.buffer.byteLength)
        return;
      let newBuffer = new ArrayBuffer(newLength);
      let newBytes = new Uint8Array(newBuffer);
      newBytes.set(this.bytes, 0);
      this.buffer = newBuffer;
      this.bytes = newBytes;
    }
    write(data) {
      this.ensureSize(this.pos + data.byteLength);
      this.bytes.set(data, this.pos);
      this.pos += data.byteLength;
    }
    seek(newPos) {
      this.pos = newPos;
    }
    finalize() {
      this.ensureSize(this.pos);
      return this.buffer.slice(0, this.pos);
    }
  };
  var FILE_CHUNK_SIZE = __pow(2, 24);
  var MAX_CHUNKS_AT_ONCE = 2;
  var FileSystemWritableFileStreamWriteTarget = class extends WriteTarget {
    constructor(stream) {
      super();
      this.chunks = [];
      this.stream = stream;
    }
    write(data) {
      this.writeDataIntoChunks(data, this.pos);
      this.flushChunks();
      this.pos += data.byteLength;
    }
    writeDataIntoChunks(data, position) {
      let chunkIndex = this.chunks.findIndex((x) => x.start <= position && position < x.start + FILE_CHUNK_SIZE);
      if (chunkIndex === -1)
        chunkIndex = this.createChunk(position);
      let chunk = this.chunks[chunkIndex];
      let relativePosition = position - chunk.start;
      let toWrite = data.subarray(0, Math.min(FILE_CHUNK_SIZE - relativePosition, data.byteLength));
      chunk.data.set(toWrite, relativePosition);
      let section = {
        start: relativePosition,
        end: relativePosition + toWrite.byteLength
      };
      insertSectionIntoFileChunk(chunk, section);
      if (chunk.written[0].start === 0 && chunk.written[0].end === FILE_CHUNK_SIZE) {
        chunk.shouldFlush = true;
      }
      if (this.chunks.length > MAX_CHUNKS_AT_ONCE) {
        for (let i = 0; i < this.chunks.length - 1; i++) {
          this.chunks[i].shouldFlush = true;
        }
        this.flushChunks();
      }
      if (toWrite.byteLength < data.byteLength) {
        this.writeDataIntoChunks(data.subarray(toWrite.byteLength), position + toWrite.byteLength);
      }
    }
    createChunk(includesPosition) {
      let start = Math.floor(includesPosition / FILE_CHUNK_SIZE) * FILE_CHUNK_SIZE;
      let chunk = {
        start,
        data: new Uint8Array(FILE_CHUNK_SIZE),
        written: [],
        shouldFlush: false
      };
      this.chunks.push(chunk);
      this.chunks.sort((a, b) => a.start - b.start);
      return this.chunks.indexOf(chunk);
    }
    flushChunks(force = false) {
      for (let i = 0; i < this.chunks.length; i++) {
        let chunk = this.chunks[i];
        if (!chunk.shouldFlush && !force)
          continue;
        for (let section of chunk.written) {
          this.stream.write({
            type: "write",
            data: chunk.data.subarray(section.start, section.end),
            position: chunk.start + section.start
          });
        }
        this.chunks.splice(i--, 1);
      }
    }
    seek(newPos) {
      this.pos = newPos;
    }
    finalize() {
      this.flushChunks(true);
    }
  };
  var insertSectionIntoFileChunk = (chunk, section) => {
    let low = 0;
    let high = chunk.written.length - 1;
    let index = -1;
    while (low <= high) {
      let mid = Math.floor(low + (high - low + 1) / 2);
      if (chunk.written[mid].start <= section.start) {
        low = mid + 1;
        index = mid;
      } else {
        high = mid - 1;
      }
    }
    chunk.written.splice(index + 1, 0, section);
    if (index === -1 || chunk.written[index].end < section.start)
      index++;
    while (index < chunk.written.length - 1 && chunk.written[index].end >= chunk.written[index + 1].start) {
      chunk.written[index].end = Math.max(chunk.written[index].end, chunk.written[index + 1].end);
      chunk.written.splice(index + 1, 1);
    }
  };

  // src/main.ts
  var VIDEO_TRACK_NUMBER = 1;
  var AUDIO_TRACK_NUMBER = 2;
  var VIDEO_TRACK_TYPE = 1;
  var AUDIO_TRACK_TYPE = 2;
  var MAX_CHUNK_LENGTH_MS = __pow(2, 15);
  var CODEC_PRIVATE_MAX_SIZE = __pow(2, 12);
  var APP_NAME = "https://github.com/Vanilagy/webm-muxer";
  var SEGMENT_SIZE_BYTES = 6;
  var CLUSTER_SIZE_BYTES = 5;
  var WebMMuxer = class {
    constructor(options) {
      this.duration = 0;
      this.videoChunkQueue = [];
      this.audioChunkQueue = [];
      this.lastVideoTimestamp = 0;
      this.lastAudioTimestamp = 0;
      this.finalized = false;
      this.options = options;
      if (options.target === "buffer") {
        this.target = new ArrayBufferWriteTarget();
      } else {
        this.target = new FileSystemWritableFileStreamWriteTarget(options.target);
      }
      this.createFileHeader();
    }
    createFileHeader() {
      this.writeEBMLHeader();
      this.createSeekHead();
      this.createSegmentInfo();
      this.createTracks();
      this.createSegment();
      this.createCues();
    }
    writeEBMLHeader() {
      let ebmlHeader = { id: 440786851 /* EBML */, data: [
        { id: 17030 /* EBMLVersion */, data: 1 },
        { id: 17143 /* EBMLReadVersion */, data: 1 },
        { id: 17138 /* EBMLMaxIDLength */, data: 4 },
        { id: 17139 /* EBMLMaxSizeLength */, data: 8 },
        { id: 17026 /* DocType */, data: "webm" },
        { id: 17031 /* DocTypeVersion */, data: 2 },
        { id: 17029 /* DocTypeReadVersion */, data: 2 }
      ] };
      this.target.writeEBML(ebmlHeader);
    }
    createSeekHead() {
      const kaxCues = new Uint8Array([28, 83, 187, 107]);
      const kaxInfo = new Uint8Array([21, 73, 169, 102]);
      const kaxTracks = new Uint8Array([22, 84, 174, 107]);
      let seekHead = { id: 290298740 /* SeekHead */, data: [
        { id: 19899 /* Seek */, data: [
          { id: 21419 /* SeekID */, data: kaxCues },
          { id: 21420 /* SeekPosition */, size: 5, data: 0 }
        ] },
        { id: 19899 /* Seek */, data: [
          { id: 21419 /* SeekID */, data: kaxInfo },
          { id: 21420 /* SeekPosition */, size: 5, data: 0 }
        ] },
        { id: 19899 /* Seek */, data: [
          { id: 21419 /* SeekID */, data: kaxTracks },
          { id: 21420 /* SeekPosition */, size: 5, data: 0 }
        ] }
      ] };
      this.seekHead = seekHead;
    }
    createSegmentInfo() {
      let segmentDuration = { id: 17545 /* Duration */, data: new EBMLFloat64(0) };
      this.segmentDuration = segmentDuration;
      let segmentInfo = { id: 357149030 /* Info */, data: [
        { id: 2807729 /* TimestampScale */, data: 1e6 },
        { id: 19840 /* MuxingApp */, data: APP_NAME },
        { id: 22337 /* WritingApp */, data: APP_NAME },
        segmentDuration
      ] };
      this.segmentInfo = segmentInfo;
    }
    createTracks() {
      let tracksElement = { id: 374648427 /* Tracks */, data: [] };
      this.tracksElement = tracksElement;
      if (this.options.video) {
        this.videoCodecPrivate = { id: 236 /* Void */, size: 4, data: new Uint8Array(CODEC_PRIVATE_MAX_SIZE) };
        let colourElement = { id: 21936 /* Colour */, data: [
          { id: 21937 /* MatrixCoefficients */, data: 2 },
          { id: 21946 /* TransferCharacteristics */, data: 2 },
          { id: 21947 /* Primaries */, data: 2 },
          { id: 21945 /* Range */, data: 0 }
        ] };
        this.colourElement = colourElement;
        tracksElement.data.push({ id: 174 /* TrackEntry */, data: [
          { id: 215 /* TrackNumber */, data: VIDEO_TRACK_NUMBER },
          { id: 29637 /* TrackUID */, data: VIDEO_TRACK_NUMBER },
          { id: 131 /* TrackType */, data: VIDEO_TRACK_TYPE },
          { id: 134 /* CodecID */, data: this.options.video.codec },
          this.videoCodecPrivate,
          this.options.video.frameRate ? { id: 2352003 /* DefaultDuration */, data: 1e9 / this.options.video.frameRate } : null,
          { id: 224 /* Video */, data: [
            { id: 176 /* PixelWidth */, data: this.options.video.width },
            { id: 186 /* PixelHeight */, data: this.options.video.height },
            colourElement
          ] }
        ].filter(Boolean) });
      }
      if (this.options.audio) {
        this.audioCodecPrivate = { id: 236 /* Void */, size: 4, data: new Uint8Array(CODEC_PRIVATE_MAX_SIZE) };
        tracksElement.data.push({ id: 174 /* TrackEntry */, data: [
          { id: 215 /* TrackNumber */, data: AUDIO_TRACK_NUMBER },
          { id: 29637 /* TrackUID */, data: AUDIO_TRACK_NUMBER },
          { id: 131 /* TrackType */, data: AUDIO_TRACK_TYPE },
          { id: 134 /* CodecID */, data: this.options.audio.codec },
          this.audioCodecPrivate,
          { id: 225 /* Audio */, data: [
            { id: 181 /* SamplingFrequency */, data: new EBMLFloat32(this.options.audio.sampleRate) },
            { id: 159 /* Channels */, data: this.options.audio.numberOfChannels },
            this.options.audio.bitDepth ? { id: 25188 /* BitDepth */, data: this.options.audio.bitDepth } : null
          ].filter(Boolean) }
        ] });
      }
    }
    createSegment() {
      let segment = { id: 408125543 /* Segment */, size: SEGMENT_SIZE_BYTES, data: [
        this.seekHead,
        this.segmentInfo,
        this.tracksElement
      ] };
      this.segment = segment;
      this.target.writeEBML(segment);
    }
    createCues() {
      this.cues = { id: 475249515 /* Cues */, data: [] };
    }
    get segmentDataOffset() {
      return this.target.dataOffsets.get(this.segment);
    }
    addVideoChunk(chunk, meta, timestamp) {
      this.ensureNotFinalized();
      if (!this.options.video)
        throw new Error("No video track declared.");
      this.writeVideoDecoderConfig(meta);
      let internalChunk = this.createInternalChunk(chunk, timestamp);
      if (this.options.video.codec === "V_VP9")
        this.fixVP9ColorSpace(internalChunk);
      this.lastVideoTimestamp = internalChunk.timestamp;
      while (this.audioChunkQueue.length > 0 && this.audioChunkQueue[0].timestamp <= internalChunk.timestamp) {
        let audioChunk = this.audioChunkQueue.shift();
        this.writeSimpleBlock(audioChunk);
      }
      if (!this.options.audio || internalChunk.timestamp <= this.lastAudioTimestamp) {
        this.writeSimpleBlock(internalChunk);
      } else {
        this.videoChunkQueue.push(internalChunk);
      }
    }
    writeVideoDecoderConfig(meta) {
      if (meta.decoderConfig) {
        if (meta.decoderConfig.colorSpace) {
          let colorSpace = meta.decoderConfig.colorSpace;
          this.colorSpace = colorSpace;
          this.colourElement.data = [
            { id: 21937 /* MatrixCoefficients */, data: {
              "rgb": 1,
              "bt709": 1,
              "bt470bg": 5,
              "smpte170m": 6
            }[colorSpace.matrix] },
            { id: 21946 /* TransferCharacteristics */, data: {
              "bt709": 1,
              "smpte170m": 6,
              "iec61966-2-1": 13
            }[colorSpace.transfer] },
            { id: 21947 /* Primaries */, data: {
              "bt709": 1,
              "bt470bg": 5,
              "smpte170m": 6
            }[colorSpace.primaries] },
            { id: 21945 /* Range */, data: [1, 2][Number(colorSpace.fullRange)] }
          ];
          let endPos = this.target.pos;
          this.target.seek(this.target.offsets.get(this.colourElement));
          this.target.writeEBML(this.colourElement);
          this.target.seek(endPos);
        }
        if (meta.decoderConfig.description) {
          this.writeCodecPrivate(this.videoCodecPrivate, meta.decoderConfig.description);
        }
      }
    }
    fixVP9ColorSpace(chunk) {
      if (chunk.type !== "key")
        return;
      if (!this.colorSpace)
        return;
      let i = 0;
      if (readBits(chunk.data, 0, 2) !== 2)
        return;
      i += 2;
      let profile = (readBits(chunk.data, i + 1, i + 2) << 1) + readBits(chunk.data, i + 0, i + 1);
      i += 2;
      if (profile === 3)
        i++;
      let showExistingFrame = readBits(chunk.data, i + 0, i + 1);
      i++;
      if (showExistingFrame)
        return;
      let frameType = readBits(chunk.data, i + 0, i + 1);
      i++;
      if (frameType !== 0)
        return;
      i += 2;
      let syncCode = readBits(chunk.data, i + 0, i + 24);
      i += 24;
      if (syncCode !== 4817730)
        return;
      if (profile >= 2)
        i++;
      let colorSpaceID = {
        "rgb": 7,
        "bt709": 2,
        "bt470bg": 1,
        "smpte170m": 3
      }[this.colorSpace.matrix];
      writeBits(chunk.data, i + 0, i + 3, colorSpaceID);
    }
    addAudioChunk(chunk, meta, timestamp) {
      this.ensureNotFinalized();
      if (!this.options.audio)
        throw new Error("No audio track declared.");
      let internalChunk = this.createInternalChunk(chunk, timestamp);
      this.lastAudioTimestamp = internalChunk.timestamp;
      while (this.videoChunkQueue.length > 0 && this.videoChunkQueue[0].timestamp <= internalChunk.timestamp) {
        let videoChunk = this.videoChunkQueue.shift();
        this.writeSimpleBlock(videoChunk);
      }
      if (!this.options.video || internalChunk.timestamp <= this.lastVideoTimestamp) {
        this.writeSimpleBlock(internalChunk);
      } else {
        this.audioChunkQueue.push(internalChunk);
      }
      if (meta.decoderConfig) {
        this.writeCodecPrivate(this.audioCodecPrivate, meta.decoderConfig.description);
      }
    }
    createInternalChunk(externalChunk, timestamp) {
      let data = new Uint8Array(externalChunk.byteLength);
      externalChunk.copyTo(data);
      let internalChunk = {
        data,
        timestamp: timestamp != null ? timestamp : externalChunk.timestamp,
        type: externalChunk.type,
        trackNumber: externalChunk instanceof EncodedVideoChunk ? VIDEO_TRACK_NUMBER : AUDIO_TRACK_NUMBER
      };
      return internalChunk;
    }
    writeSimpleBlock(chunk) {
      let msTime = Math.floor(chunk.timestamp / 1e3);
      let clusterIsTooLong = chunk.type !== "key" && msTime - this.currentClusterTimestamp >= MAX_CHUNK_LENGTH_MS;
      if (clusterIsTooLong) {
        throw new Error(
          `Current Matroska cluster exceeded its maximum allowed length of ${MAX_CHUNK_LENGTH_MS} milliseconds. In order to produce a correct WebM file, you must pass in a video key frame at least every ${MAX_CHUNK_LENGTH_MS} milliseconds.`
        );
      }
      let shouldCreateNewClusterFromKeyFrame = (chunk.trackNumber === VIDEO_TRACK_NUMBER || !this.options.video) && chunk.type === "key" && msTime - this.currentClusterTimestamp >= 1e3;
      if (!this.currentCluster || shouldCreateNewClusterFromKeyFrame) {
        this.createNewCluster(msTime);
      }
      let prelude = new Uint8Array(4);
      let view = new DataView(prelude.buffer);
      view.setUint8(0, 128 | chunk.trackNumber);
      view.setUint16(1, msTime - this.currentClusterTimestamp, false);
      view.setUint8(3, Number(chunk.type === "key") << 7);
      let simpleBlock = { id: 163 /* SimpleBlock */, data: [
        prelude,
        chunk.data
      ] };
      this.target.writeEBML(simpleBlock);
      this.duration = Math.max(this.duration, msTime);
    }
    writeCodecPrivate(element, data) {
      let endPos = this.target.pos;
      this.target.seek(this.target.offsets.get(element));
      element = [
        { id: 25506 /* CodecPrivate */, size: 4, data: new Uint8Array(data) },
        { id: 236 /* Void */, size: 4, data: new Uint8Array(CODEC_PRIVATE_MAX_SIZE - 2 - 4 - data.byteLength) }
      ];
      this.target.writeEBML(element);
      this.target.seek(endPos);
    }
    createNewCluster(timestamp) {
      if (this.currentCluster) {
        this.finalizeCurrentCluster();
      }
      this.currentCluster = { id: 524531317 /* Cluster */, size: CLUSTER_SIZE_BYTES, data: [
        { id: 231 /* Timestamp */, data: timestamp }
      ] };
      this.target.writeEBML(this.currentCluster);
      this.currentClusterTimestamp = timestamp;
      let clusterOffsetFromSegment = this.target.offsets.get(this.currentCluster) - this.segmentDataOffset;
      this.cues.data.push({ id: 187 /* CuePoint */, data: [
        { id: 179 /* CueTime */, data: timestamp },
        { id: 183 /* CueTrackPositions */, data: [
          { id: 247 /* CueTrack */, data: VIDEO_TRACK_NUMBER },
          { id: 241 /* CueClusterPosition */, data: clusterOffsetFromSegment }
        ] }
      ] });
    }
    finalizeCurrentCluster() {
      let clusterSize = this.target.pos - this.target.dataOffsets.get(this.currentCluster);
      let endPos = this.target.pos;
      this.target.seek(this.target.offsets.get(this.currentCluster) + 4);
      this.target.writeEBMLVarInt(clusterSize, CLUSTER_SIZE_BYTES);
      this.target.seek(endPos);
    }
    finalize() {
      while (this.videoChunkQueue.length > 0)
        this.writeSimpleBlock(this.videoChunkQueue.shift());
      while (this.audioChunkQueue.length > 0)
        this.writeSimpleBlock(this.audioChunkQueue.shift());
      this.finalizeCurrentCluster();
      this.target.writeEBML(this.cues);
      let endPos = this.target.pos;
      let segmentSize = this.target.pos - this.segmentDataOffset;
      this.target.seek(this.target.offsets.get(this.segment) + 4);
      this.target.writeEBMLVarInt(segmentSize, SEGMENT_SIZE_BYTES);
      this.segmentDuration.data = new EBMLFloat64(this.duration);
      this.target.seek(this.target.offsets.get(this.segmentDuration));
      this.target.writeEBML(this.segmentDuration);
      this.seekHead.data[0].data[1].data = this.target.offsets.get(this.cues) - this.segmentDataOffset;
      this.seekHead.data[1].data[1].data = this.target.offsets.get(this.segmentInfo) - this.segmentDataOffset;
      this.seekHead.data[2].data[1].data = this.target.offsets.get(this.tracksElement) - this.segmentDataOffset;
      this.target.seek(this.target.offsets.get(this.seekHead));
      this.target.writeEBML(this.seekHead);
      this.target.seek(endPos);
      this.finalized = true;
      if (this.target instanceof ArrayBufferWriteTarget) {
        return this.target.finalize();
      } else if (this.target instanceof FileSystemWritableFileStreamWriteTarget) {
        this.target.finalize();
      }
      return null;
    }
    ensureNotFinalized() {
      if (this.finalized) {
        throw new Error("Cannot add new video or audio chunks after the file has been finalized.");
      }
    }
  };
  var main_default = WebMMuxer;
  var readBits = (bytes, start, end) => {
    let result = 0;
    for (let i = start; i < end; i++) {
      let byteIndex = Math.floor(i / 8);
      let byte = bytes[byteIndex];
      let bitIndex = 7 - (i & 7);
      let bit = (byte & 1 << bitIndex) >> bitIndex;
      result <<= 1;
      result |= bit;
    }
    return result;
  };
  var writeBits = (bytes, start, end, value) => {
    for (let i = start; i < end; i++) {
      let byteIndex = Math.floor(i / 8);
      let byte = bytes[byteIndex];
      let bitIndex = 7 - (i & 7);
      byte &= ~(1 << bitIndex);
      byte |= (value & 1 << end - i - 1) >> end - i - 1 << bitIndex;
      bytes[byteIndex] = byte;
    }
  };
  return __toCommonJS(main_exports);
})();
WebMMuxer = WebMMuxer.default;
if (typeof module === "object" && typeof module.exports === "object") module.exports = WebMMuxer;
