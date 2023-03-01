# webm-muxer - JavaScript WebM multiplexer

[![](https://img.shields.io/npm/v/webm-muxer)](https://www.npmjs.com/package/webm-muxer)
[![](https://img.shields.io/bundlephobia/minzip/webm-muxer)](https://bundlephobia.com/package/webm-muxer)

The WebCodecs API provides low-level access to media codecs, but provides no way of actually packaging (multiplexing)
the encoded media into a playable file. This project implements a WebM/Matroska multiplexer in pure TypeScript, which is
high-quality, fast and tiny, and supports both video and audio.

[Demo](https://vanilagy.github.io/webm-muxer/demo/)

## Quick start
The following is an example for a common usage of this library:
```js
import WebMMuxer from 'webm-muxer';

let muxer = new WebMMuxer({
    target: 'buffer',
    video: {
        codec: 'V_VP9',
        width: 1280,
        height: 720
    }
});

let videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: e => console.error(e)
});
videoEncoder.configure({
    codec: 'vp09.00.10.08',
    width: 1280,
    height: 720,
    bitrate: 1e6
});

/* Encode some frames... */

await videoEncoder.flush();
let buffer = muxer.finalize(); // Buffer contains final WebM file
```

## Motivation
This library was created to power the in-game video renderer of the browser game
[Marble Blast Web](https://github.com/vanilagy/marbleblast) - [here](https://www.youtube.com/watch?v=ByCcAIoXsKY) you can find a video completely rendered by it and muxed with this library. Previous efforts at in-browser WebM muxing, such as
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
### Initialization
For each WebM file you wish to create, create an instance of `WebMMuxer` like so:
```js
let muxer = new WebMMuxer(options);
```
The available options are defined by the following interface:
```ts
interface WebMMuxerOptions {
    target: 'buffer'
        | ((data: Uint8Array, offset: number, done: boolean) => void)
        | FileSystemWritableFileStream

    video?: {
        codec: string,
        width: number,
        height: number,
        frameRate?: number, // Optional, adds metadata to the file
        alpha?: boolean // If the video contains transparency data
    },

    audio?: {
        codec: string,
        numberOfChannels: number,
        sampleRate: number,
        bitDepth?: number // Mainly necessary for PCM-coded audio
    },

    type?: 'webm' | 'matroska',

    firstTimestampBehavior?: 'strict' | 'offset' | 'permissive'
}
```
Codecs officially supported by WebM are `V_VP8`, `V_VP9`, `V_AV1`, `A_OPUS` and `A_VORBIS`.
#### `target`
This option specifies what will happens with the data created by the muxer. The options are:
- `'buffer'`: The file data will be written into a single, large buffer which is then returned by `finalize`.

    ```js
    let muxer = new WebMMuxer({
        target: 'buffer',
        video: {
            codec: 'V_VP9',
            width: 1280,
            height: 720
        }
    });

    // ...

    let buffer = muxer.finalize();
    ```
- `function`: If the target is a function, it will be called each time data is output by the muxer - this is useful if
    you want to stream the data. The function will be called with three arguments: the data to write, the offset in
    bytes at which to write the data and a boolean indicating whether the muxer is done writing data. Note that the same
    segment of bytes might be written to multiple times and therefore you need to write the data in the same order the
    function gave it to you.

    ```js
    let muxer = new WebMMuxer({
        target: (data, offset, done) => {
            // Do something with the data
        },
        audio: {
            codec: 'A_OPUS',
            numberOfChannels: 1,
            sampleRate: 44100
        }
    });
    ```
- `FileSystemWritableFileStream`: When acquired through the File System Access API, the
    muxed file is written directly to disk, allowing for files way larger than what would fit in RAM. This functionality could also be manually emulated by passing a `function` instead, however, this library has some built-in write batching optimization which will be used when passing a FileSystemWritableFileStream.

    ```js
    let fileHandle = await window.showSaveFilePicker({
        suggestedName: `video.webm`,
        types: [{
            description: 'Video File',
            accept: { 'video/webm': ['.webm'] }
        }],
    });
    let fileWritableStream = await fileHandle.createWritable();
    let muxer = new WebMMuxer({
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
    ```
#### `type` (optional)
As WebM is a subset of the more general Matroska multimedia container format, this library muxes both WebM and Matroska
files. WebM, according to the official specification, supports only a small subset of the codecs supported by Matroska.
It is likely, however, that most players will successfully play back a WebM file with codecs other than the ones
supported in the spec. To be on the safe side, however, you can set the `type` option to `'matroska'`, which
will internally label the file as a general Matroska file. If you do this, your output file should also have the .mkv
extension.
#### `firstTimestampBehavior` (optional)
Specifies how to deal with the first chunk in each track having a non-zero timestamp. In the default strict mode,
timestamps must start with 0 to ensure proper playback. However, when directly pumping video frames or audio data
from a MediaTrackStream into the encoder and then the muxer, the timestamps are usually relative to the age of
the document or the computer's clock, which is typically not what we want. Handling of these timestamps must be
set explicitly:
- Use `'offset'` to offset the timestamp of each video track by that track's first chunk's timestamp. This way, it
starts at 0.
- Use `'permissive'` to allow the first timestamp to be non-zero.

### Muxing media chunks
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

### Finishing up
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
When there is only one media track, this issue does not arise. So, when muxing a multimedia file, make sure it is
somewhat limited in size or the chunks are encoded in a somewhat interleaved way (like is the case for live media).

### Size "limits"
This library can mux WebM files up to a total size of ~4398 GB and with a Matroska Cluster size of ~34 GB.

## Implementation
WebM files are a subset of the more general Matroska media container format. Matroska in turn uses a format known as
EBML (think of it like binary XML) to structure its file. This project therefore implements a simple EBML writer to
create the Matroska elements needed to form a WebM file. Many thanks to
[webm-writer-js](https://github.com/thenickdude/webm-writer-js) for being the inspiration for most of the core EBML
writing code.

For development, clone this repository, install everything with `npm i`, then run `npm run watch` to bundle the code
into the `build` directory.
