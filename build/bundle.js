"use strict";
(() => {
  // src/main.ts
  var VIDEO_TRACK_NUMBER = 1;
  var AUDIO_TRACK_NUMBER = 2;
  var MAX_CHUNK_LENGTH_MS = 32e3;
  var EBMLFloat32 = class {
    value;
    constructor(value) {
      this.value = value;
    }
  };
  var EBMLFloat64 = class {
    value;
    constructor(value) {
      this.value = value;
    }
  };
  var WriteTarget = class {
    pos = 0;
    helper = new Uint8Array(8);
    helperView = new DataView(this.helper.buffer);
    offsets = /* @__PURE__ */ new WeakMap();
    writeU8(value) {
      this.helperView.setUint8(0, value);
      this.write(this.helper.subarray(0, 1));
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
      switch (width) {
        case 5:
          this.writeU8(
            Math.floor(value / 2 ** 32)
          );
        case 4:
          this.writeU8(value >> 24);
        case 3:
          this.writeU8(value >> 16);
        case 2:
          this.writeU8(value >> 8);
        case 1:
          this.writeU8(value);
          break;
        default:
          throw new Error("Bad UINT size " + width);
      }
    }
    writeEBMLVarInt(value, width = measureEBMLVarInt(value)) {
      switch (width) {
        case 1:
          this.writeU8(1 << 7 | value);
          break;
        case 2:
          this.writeU8(1 << 6 | value >> 8);
          this.writeU8(value);
          break;
        case 3:
          this.writeU8(1 << 5 | value >> 16);
          this.writeU8(value >> 8);
          this.writeU8(value);
          break;
        case 4:
          this.writeU8(1 << 4 | value >> 24);
          this.writeU8(value >> 16);
          this.writeU8(value >> 8);
          this.writeU8(value);
          break;
        case 5:
          this.writeU8(1 << 3 | value / 4294967296 & 7);
          this.writeU8(value >> 24);
          this.writeU8(value >> 16);
          this.writeU8(value >> 8);
          this.writeU8(value);
          break;
        default:
          throw new Error("Bad EBML VINT size " + width);
      }
    }
    writeString(str) {
      this.write(new Uint8Array(str.split("").map((x) => x.charCodeAt(0))));
    }
    writeEBML(data) {
      if (data instanceof Uint8Array) {
        this.write(data);
      } else if (Array.isArray(data)) {
        for (let elem of data) {
          this.writeEBML(elem);
        }
      } else {
        this.offsets.set(data, this.pos);
        this.writeUnsignedInt(data.id);
        if (typeof data.data === "number") {
          let size = data.size ?? measureUnsignedInt(data.data);
          this.writeEBMLVarInt(size);
          this.writeUnsignedInt(data.data, size);
        } else if (Array.isArray(data.data)) {
          let sizePos = this.pos;
          this.seek(this.pos + 4);
          let startPos = this.pos;
          this.writeEBML(data.data);
          let size = this.pos - startPos;
          let endPos = this.pos;
          this.seek(sizePos);
          this.writeEBMLVarInt(size, 4);
          this.seek(endPos);
        } else if (typeof data.data === "string") {
          this.writeEBMLVarInt(data.data.length);
          this.writeString(data.data);
        } else if (data.data instanceof Uint8Array) {
          this.writeEBMLVarInt(data.data.byteLength);
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
  var ArrayBufferWriteTarget = class extends WriteTarget {
    buffer = new ArrayBuffer(2 ** 24);
    bytes = new Uint8Array(this.buffer);
    constructor() {
      super();
    }
    write(data) {
      this.bytes.set(data, this.pos);
      this.pos += data.byteLength;
    }
    seek(newPos) {
      this.pos = newPos;
    }
    finalize() {
      return this.bytes.slice(0, this.pos);
    }
  };
  var measureUnsignedInt = (value) => {
    if (value < 1 << 8) {
      return 1;
    } else if (value < 1 << 16) {
      return 2;
    } else if (value < 1 << 24) {
      return 3;
    } else if (value < 2 ** 32) {
      return 4;
    } else {
      return 5;
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
    } else if (value < 2 ** 35 - 1) {
      return 5;
    } else {
      throw new Error("EBML VINT size not supported " + value);
    }
  };
  var saveFile = (blob, filename = "unnamed.webm") => {
    const a = document.createElement("a");
    document.body.appendChild(a);
    const url = window.URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => {
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }, 0);
  };
  var WebMWriter = class {
    target;
    options;
    segment;
    segmentInfo;
    tracksElement;
    currentCluster;
    currentClusterTimestamp;
    segmentDuration;
    audioCodecPrivate;
    cues;
    seekHead;
    duration = 0;
    videoChunkQueue = [];
    audioChunkQueue = [];
    lastVideoTimestamp = 0;
    lastAudioTimestamp = 0;
    constructor(options) {
      this.target = new ArrayBufferWriteTarget();
      this.options = options;
      this.writeHeader();
    }
    writeHeader() {
      let ebmlHeader = { id: 440786851, data: [
        { id: 17030, data: 1 },
        { id: 17143, data: 1 },
        { id: 17138, data: 4 },
        { id: 17139, data: 8 },
        { id: 17026, data: "webm" },
        { id: 17031, data: 2 },
        { id: 17029, data: 2 }
      ] };
      this.target.writeEBML(ebmlHeader);
      let seekHead = { id: 290298740, data: [
        { id: 19899, data: [
          { id: 21419, data: new Uint8Array([28, 83, 187, 107]) },
          { id: 21420, size: 5, data: 0 }
        ] },
        { id: 19899, data: [
          { id: 21419, data: new Uint8Array([21, 73, 169, 102]) },
          { id: 21420, size: 5, data: 0 }
        ] },
        { id: 19899, data: [
          { id: 21419, data: new Uint8Array([22, 84, 174, 107]) },
          { id: 21420, size: 5, data: 0 }
        ] }
      ] };
      this.seekHead = seekHead;
      let segmentDuration = { id: 17545, data: new EBMLFloat64(0) };
      this.segmentDuration = segmentDuration;
      let segmentInfo = { id: 357149030, data: [
        { id: 2807729, data: 1e6 },
        { id: 19840, data: "Vani's epic muxer" },
        { id: 22337, data: "Vani's epic muxer" },
        segmentDuration
      ] };
      this.segmentInfo = segmentInfo;
      let tracksElement = { id: 374648427, data: [] };
      this.tracksElement = tracksElement;
      if (this.options.video) {
        tracksElement.data.push({ id: 174, data: [
          { id: 215, data: VIDEO_TRACK_NUMBER },
          { id: 29637, data: VIDEO_TRACK_NUMBER },
          { id: 131, data: 1 },
          { id: 134, data: this.options.video.codec },
          { id: 224, data: [
            { id: 176, data: this.options.video.width },
            { id: 186, data: this.options.video.height }
          ] }
        ] });
      }
      if (this.options.audio) {
        this.audioCodecPrivate = { id: 25506, data: new Uint8Array(19) };
        tracksElement.data.push({ id: 174, data: [
          { id: 215, data: AUDIO_TRACK_NUMBER },
          { id: 29637, data: AUDIO_TRACK_NUMBER },
          { id: 131, data: 2 },
          { id: 134, data: this.options.audio.codec },
          this.audioCodecPrivate,
          { id: 225, data: [
            { id: 181, data: new EBMLFloat32(this.options.audio.sampleRate) },
            { id: 159, data: this.options.audio.numberOfChannels }
          ] }
        ] });
      }
      let segment = { id: 408125543, size: 5, data: [
        seekHead,
        segmentInfo,
        tracksElement
      ] };
      this.segment = segment;
      this.target.writeEBML(segment);
      this.cues = { id: 475249515, data: [] };
    }
    addVideoChunk(chunk) {
      this.lastVideoTimestamp = chunk.timestamp;
      console.log(chunk);
      while (this.audioChunkQueue.length > 0 && this.audioChunkQueue[0].timestamp <= chunk.timestamp) {
        let audioChunk = this.audioChunkQueue.shift();
        this.writeSimpleBlock(audioChunk);
      }
      if (!this.options.audio || chunk.timestamp <= this.lastAudioTimestamp) {
        this.writeSimpleBlock(chunk);
        this.lastVideoTimestamp = chunk.timestamp;
      } else {
        this.videoChunkQueue.push(chunk);
      }
    }
    addAudioChunk(chunk, meta) {
      this.lastAudioTimestamp = chunk.timestamp;
      console.log(chunk);
      while (this.videoChunkQueue.length > 0 && this.videoChunkQueue[0].timestamp <= chunk.timestamp) {
        let videoChunk = this.videoChunkQueue.shift();
        this.writeSimpleBlock(videoChunk);
      }
      if (!this.options.video || chunk.timestamp <= this.lastVideoTimestamp) {
        this.writeSimpleBlock(chunk);
        this.lastAudioTimestamp = chunk.timestamp;
      } else {
        this.audioChunkQueue.push(chunk);
      }
      if (meta?.decoderConfig) {
        this.audioCodecPrivate.data = new Uint8Array(meta.decoderConfig.description);
        let endPos = this.target.pos;
        this.target.seek(this.target.offsets.get(this.audioCodecPrivate));
        this.target.writeEBML(this.audioCodecPrivate);
        this.target.seek(endPos);
      }
    }
    writeSimpleBlock(chunk) {
      let msTime = Math.floor(chunk.timestamp / 1e3);
      if (!this.currentCluster || (chunk instanceof EncodedVideoChunk && chunk.type === "key" || msTime - this.currentClusterTimestamp >= MAX_CHUNK_LENGTH_MS)) {
        this.createNewCluster(msTime);
      }
      let prelude = new Uint8Array(4);
      let view = new DataView(prelude.buffer);
      view.setUint8(0, 128 | (chunk instanceof EncodedVideoChunk ? VIDEO_TRACK_NUMBER : AUDIO_TRACK_NUMBER));
      view.setUint16(1, msTime - this.currentClusterTimestamp, false);
      view.setUint8(3, Number(chunk.type === "key") << 7);
      let data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      let simpleBlock = { id: 163, data: [
        prelude,
        data
      ] };
      this.target.writeEBML(simpleBlock);
      this.duration = Math.max(this.duration, msTime);
    }
    createNewCluster(timestamp) {
      if (this.currentCluster) {
        this.finalizeCurrentCluster();
      }
      this.currentCluster = { id: 524531317, data: [
        { id: 231, data: timestamp }
      ] };
      this.target.writeEBML(this.currentCluster);
      this.currentClusterTimestamp = timestamp;
      this.cues.data.push({ id: 187, data: [
        { id: 179, data: timestamp },
        { id: 183, data: [
          { id: 247, data: VIDEO_TRACK_NUMBER },
          { id: 241, data: this.target.offsets.get(this.currentCluster) - (this.target.offsets.get(this.segment) + 8) }
        ] }
      ] });
    }
    finalizeCurrentCluster() {
      let clusterSize = this.target.pos - (this.target.offsets.get(this.currentCluster) + 8);
      let endPos = this.target.pos;
      this.target.seek(this.target.offsets.get(this.currentCluster) + 4);
      this.target.writeEBMLVarInt(clusterSize, 4);
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
      let segmentSize = this.target.pos - (this.target.offsets.get(this.segment) + 8);
      this.target.seek(this.target.offsets.get(this.segment) + 4);
      this.target.writeEBMLVarInt(segmentSize, 4);
      this.segmentDuration.data = new EBMLFloat64(this.duration);
      this.target.seek(this.target.offsets.get(this.segmentDuration));
      this.target.writeEBML(this.segmentDuration);
      this.seekHead.data[0].data[1].data = this.target.offsets.get(this.cues) - (this.target.offsets.get(this.segment) + 8);
      this.seekHead.data[1].data[1].data = this.target.offsets.get(this.segmentInfo) - (this.target.offsets.get(this.segment) + 8);
      this.seekHead.data[2].data[1].data = this.target.offsets.get(this.tracksElement) - (this.target.offsets.get(this.segment) + 8);
      this.target.seek(this.target.offsets.get(this.seekHead));
      this.target.writeEBML(this.seekHead);
      this.target.seek(endPos);
    }
  };
  (async () => {
    let sampleRate = 48e3;
    let writer = new WebMWriter({
      video: {
        codec: "V_VP9",
        width: 1280,
        height: 720
      },
      audio: {
        codec: "A_OPUS",
        numberOfChannels: 1,
        sampleRate
      }
    });
    let canvas = document.createElement("canvas");
    canvas.setAttribute("width", "1280");
    canvas.setAttribute("height", "720");
    let ctx = canvas.getContext("2d");
    let videoEncoder = new VideoEncoder({
      output: (chunk) => writer.addVideoChunk(chunk),
      error: (e) => console.error(e)
    });
    videoEncoder.configure({
      codec: "vp09.00.10.08",
      width: 1280,
      height: 720,
      bitrate: 1e6
    });
    let audioEncoder = new AudioEncoder({
      output: (chunk, meta) => writer.addAudioChunk(chunk, meta),
      error: (e) => console.error(e)
    });
    audioEncoder.configure({
      codec: "opus",
      numberOfChannels: 1,
      sampleRate,
      bitrate: 32e3
    });
    let audioContext = new AudioContext();
    let audioBuffer = await audioContext.decodeAudioData(await (await fetch("./CantinaBand60.wav")).arrayBuffer());
    let length = 5;
    let data = new Float32Array(length * sampleRate);
    data.set(audioBuffer.getChannelData(0).subarray(0, data.length), 0);
    let audioData = new AudioData({
      format: "f32",
      sampleRate,
      numberOfFrames: length * sampleRate,
      numberOfChannels: 1,
      timestamp: 0,
      data
    });
    audioEncoder.encode(audioData);
    audioData.close();
    for (let i = 0; i < length * 5; i++) {
      ctx.fillStyle = ["red", "lime", "blue", "yellow"][Math.floor(Math.random() * 4)];
      ctx.fillRect(Math.random() * 1280, Math.random() * 720, Math.random() * 1280, Math.random() * 720);
      let videoFrame = new VideoFrame(canvas, { timestamp: i * 1e6 / 5 });
      videoEncoder.encode(videoFrame);
      videoFrame.close();
    }
    await Promise.allSettled([videoEncoder.flush(), audioEncoder.flush()]);
    writer.finalize();
    let buffer = writer.target.finalize();
    console.log(buffer);
    saveFile(new Blob([buffer]));
  })();
})();
