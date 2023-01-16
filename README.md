# webm-muxer - JavaScript WebM multiplexer

[![](https://img.shields.io/npm/v/webm-muxer)](https://www.npmjs.com/package/webm-muxer)
[![](https://img.shields.io/bundlephobia/minzip/webm-muxer)](https://bundlephobia.com/package/webm-muxer)

The WebCodecs API provides low-level access to media codecs, but provides no way of actually packaging (multiplexing)
the encoded media into a playable file. This project implements a WebM multiplexer in pure TypeScript, which is
high-quality, fast and tiny, and supports both video and audio.

[Demo](https://vanilagy.github.io/webm-muxer/demo/)

## Motivation
This library was created to power the in-game video renderer of the browser game
[Marble Blast Web](https://github.com/vanilagy/marbleblast). Previous efforts at in-browser WebM muxing, such as
[webm-writer-js](https://github.com/thenickdude/webm-writer-js) or
[webm-muxer.js](https://github.com/davedoesdev/webm-muxer.js), were either lacking in functionality or were way too
heavy in terms of byte size, which prompted the creation of this library.

## Installation
Using NPM, simply install this package using
```
npm install webm-muxer
```
The package has a single, default export, `WebMMuxer`:
```js
import WebMMuxer from 'webm-muxer';
// Or, using CommonJS:
const WebMMuxer = require('webm-muxer');
```
Alternatively, you can simply include the library as a script in your HTML, which will add `WebMMuxer` to the global
object, like so:
```html
<script src="build/webm-muxer.js"></script>
```

## Usage
For each WebM file you wish to create, create an instance of `WebMMuxer` like so:
```js
let muxer = new WebMMuxer(options);
```
The available options are defined by the following interface:
```ts
interface WebMMuxerOptions {
    // When 'buffer' is used, the muxed file is written to a buffer in
    // memory. When a FileSystemWritableFileStream acquired through
    // the File System Access API (see example below) is used, the
    // muxed file is written directly to disk, allowing for files way
    // larger than what would fit in RAM.
    target: 'buffer' | FileSystemWritableFileStream,
    video?: {
        codec: string,
        width: number,
        height: number,
        frameRate?: number // Optional, adds metadata to the file
    },
    audio?: {
        codec: string,
        numberOfChannels: number,
        sampleRate: number,
        bitDepth?: number // Mainly necessary for PCM-coded audio
    }
}
```
Codecs supported by WebM are `V_VP8`, `V_VP9`, `V_AV1`, `A_OPUS` and `A_VORBIS`.

Some examples:
```js
// Create a muxer with a video track running the VP9 codec, and no
// audio track. The muxed file is written to a buffer in memory.
let muxer1 = new WebMMuxer({
    target: 'buffer',
    video: {
        codec: 'V_VP9',
        width: 1280,
        height: 720
    }
});

// Create a muxer with a video track running the VP9 codec, and an
// audio track running the Opus codec. The muxed file is written
// directly to a file on disk, using the File System Access API.
let fileHandle = await window.showSaveFilePicker({
    suggestedName: `video.webm`,
    types: [{
        description: 'Video File',
        accept: { 'video/webm': ['.webm'] }
    }],
});
let fileWritableStream = await fileHandle.createWritable();
let muxer2 = new WebMMuxer({
    target: fileWritableStream,
    video: {
        codec: 'V_VP9',
        width: 1920,
        height: 1080,
        frameRate: 60
    },
    audio: {
        codec: 'A_OPUS',
        numberOfChannels: 2,
        sampleRate: 48000
    }
});

// Create a muxer running only an Opus-coded audio track, and
// no video. Writes to a buffer in memory.
let muxer3 = new WebMMuxer({
    target: 'buffer',
    audio: {
        codec: 'A_OPUS',
        numberOfChannels: 1,
        sampleRate: 44100
    }
});
```

Then, with VideoEncoder and AudioEncoder set up, send encoded chunks to the muxer like so:
```js
muxer.addVideoChunk(encodedVideoChunk, encodedVideoChunkMetadata);
muxer.addAudioChunk(encodedAudioChunk, encodedAudioChunkMetadata);
```
In addition, both methods accept an optional, third argument `timestamp` (microseconds) which, if specified, overrides
the `timestamp` property of the passed-in chunk. This is useful when getting chunks from a MediaStreamTrackProcessor
from live media, which usually come with huge timestamp values and don't start at 0, which we want.

The metadata comes from the second parameter of the `output` callback given to the
VideoEncoder or AudioEncoder's constructor and needs to be passed into the muxer, like so:
```js
let videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: e => console.error(e)
});
videoEncoder.configure(/* ... */);
```

Should you have obtained your encoded media data from a source other than the WebCodecs API, you can use these following
methods to directly send your raw data to the muxer:
```ts
addVideoChunkRaw(
    data: Uint8Array,
    type: 'key' | 'delta',
    timestamp: number,
    meta?: EncodedVideoChunkMetadata
): void;

addAudioChunkRaw(
    data: Uint8Array,
    type: 'key' | 'delta',
    timestamp: number,
    meta?: EncodedAudioChunkMetadata
): void;
```

When encoding is finished, call `finalize` on the `WebMMuxer` instance to finalize the WebM file. When using
`target: 'buffer'`, the resulting file's buffer is returned by this method:
```js
let buffer = muxer.finalize();
```
When using a FileSystemWritableFileStream, make sure to close the stream after calling `finalize`:
```js
await fileWritableStream.close();
```

## Details
### Video key frame frequency
Canonical WebM files can only have a maximum Matroska Cluster length of 32.768 seconds, and each cluster must begin with
a video key frame. You therefore need to tell your `VideoEncoder` to encode a `VideoFrame` as a key frame at least every
32 seconds, otherwise your WebM file will be incorrect. You can do this by doing:
```js
videoEncoder.encode(frame, { keyFrame: true });
```
### Media chunk buffering
When muxing a file with a video **and** an audio track, it is important that the individual chunks inside the WebM file
be stored in monotonically increasing time. This does mean, however, that the multiplexer must buffer chunks of one
medium if the other medium has not yet encoded chunks up to that timestamp. For example, should you first encode all
your video frames and then encode the audio afterwards, the multiplexer will have to hold all those video frames in
memory until the audio chunks start coming in. This might lead to memory exhaustion should your video be very long.
When there is only one media track, this issue does not arrive. So, when muxing a multimedia file, make sure it is
somewhat limited in size or the chunks are encoded in a somewhat interleaved way (like is the case for live media).
### Size limits
This library can mux WebM files up to a total size of ~4398 GB and with a Matroska Cluster size of ~34 GB.

## Implementation
WebM files are a subset of the more general Matroska media container format. Matroska in turn uses a format known as
EBML (think of it like binary XML) to structure its file. This project therefore implements a simple EBML writer to
create the Matroska elements needed to form a WebM file. Many thanks to
[webm-writer-js](https://github.com/thenickdude/webm-writer-js) for being the inspiration for most of the core EBML
writing code.

For development, clone this repository, install everything with `npm i`, then run `npm run watch` to bundle the code
into the `build` directory.
