# Guide: Migrating to Mediabunny

webm-muxer has been deprecated and is superseded by [Mediabunny](https://mediabunny.dev/). Mediabunny's WebM/Matroska multiplexer was originally based on the one from webm-muxer and has now evolved into a much better multiplexer:

- Produces better, more correct WebM/MKV files
- Support for multiple video, audio & subtitle tracks
- Support for more track metadata
- Pipelining & backpressure features
- Improved performance

And even though Mediabunny has many other features, it is built to be extremely tree-shakable and therefore will still result in a tiny bundle when only using its WebM multiplexer (11 kB vs webm-muxer's 8 kB). Thus, you should **always** prefer Mediabunny over webm-muxer - this library is now obsolete.

## Muxer migration

If you wanted to perform the most direct mapping possible, the following code using webm-muxer:
```ts
import { Muxer, ArrayBufferTarget } from 'webm-muxer';

let muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
        codec: 'V_VP9',
        width: VIDEO_WIDTH,
        height: VIDEO_HEIGHT,
        frameRate: VIDEO_FRAME_RATE
    },
    audio: {
        codec: 'A_OPUS',
        numberOfChannels: AUDIO_NUMBER_OF_CHANNELS,
        sampleRate: AUDIO_SAMPLE_RATE
    },
    streaming: IS_STREAMING
});

// Assuming these are called from video/audio encoder callbacks
muxer.addVideoChunk(VIDEO_CHUNK, VIDEO_CHUNK_METADATA);
muxer.addAudioChunk(AUDIO_CHUNK, AUDIO_CHUNK_METADATA);

muxer.finalize();
```

...maps to this code using Mediabunny:
```ts
import { Output, WebMOutputFormat, BufferTarget, EncodedVideoPacketSource, EncodedAudioPacketSource, EncodedPacket } from 'mediabunny';

const output = new Output({
    format: new WebMOutputFormat({
        appendOnly: IS_STREAMING
    }),
    target: new BufferTarget(),
});

const videoSource = new EncodedVideoPacketSource('vp9');
output.addVideoTrack(videoSource, {
    frameRate: VIDEO_FRAME_RATE,
});

const audioSource = new EncodedAudioPacketSource('opus');
output.addAudioTrack(audioSource);

await output.start();

// Assuming these are called from video/audio encoder callbacks
await videoSource.add(EncodedPacket.fromEncodedChunk(VIDEO_CHUNK), VIDEO_CHUNK_METADATA);
await audioSource.add(EncodedPacket.fromEncodedChunk(AUDIO_CHUNK), AUDIO_CHUNK_METADATA);

await output.finalize();
```

The major differences are:
- `Muxer` is now `Output`: Each `Output` represents one media file. The WebM-specific options are now nested within `WebMOutputFormat`.
- The `streaming` option is now `appendOnly` inside the format's options.
- Tracks must be added to the `Output` after instantiating it.
- `start` must be called before adding any media data, and after registering all tracks.
- Adding encoded chunks is no longer a direct functionality; instead, it is enabled by the `EncodedVideoPacketSource` and `EncodedAudioPacketSource`.
- Encoded chunks are now provided via Mediabunny's own [`EncodedPacket`](https://mediabunny.dev/guide/packets-and-samples#encodedpacket) class.
- Media characteristics, such as width, height, channel count, or sample rate, must no longer be specified anywhere - they are deduced automatically.
- Many methods must now be `await`ed; this is because Mediabunny is deeply pipelined with complex backpressure handling logic, which automatically propagates to the top-level code via promises.

#### Codec migration

The codec identifiers have changed from the Matroska-specific strings in webm-muxer to more generic short names in Mediabunny:

| webm-muxer | Mediabunny |
| :--- | :--- |
| `V_VP8` | `'vp8'` |
| `V_VP9` | `'vp9'` |
| `V_AV1` | `'av1'` |
| `A_OPUS` | `'opus'` |
| `A_VORBIS` | `'vorbis'` |
| `S_TEXT/WEBVTT` | `'webvtt'` |

These are the codecs supported in WebM, but of course, many more codecs are supported by Mediabunny. For a full list of codecs, including those that can be contained within Matroska, check out [Codecs](https://mediabunny.dev/guide/supported-formats-and-codecs#codecs).

### But wait:

Even though this direct mapping works, Mediabunny has rich, powerful abstractions around the WebCodecs API and it's very likely you can ditch your entire manual encoding stack altogether. This means you likely won't need to use `EncodedVideoPacketSource` or `EncodedAudioPacketSource` at all.

To learn more, read up on [Media sources](https://mediabunny.dev/guide/media-sources).

## Target migration

An `Output`'s target can be accessed via `output.target`.

### `ArrayBufferTarget`

This class is simply called `BufferTarget` now. Just like `ArrayBufferTarget`, its `buffer` property is `null` before file finalization and an `ArrayBuffer` after.

### `StreamTarget`

This class is still called `StreamTarget` in Mediabunny but is now based on [`WritableStream`](https://developer.mozilla.org/en-US/docs/Web/API/WritableStream) to integrate natively with the Streams API and allow for writer backpressure.

The `onHeader` and `onCluster` callbacks have been moved into the format's options. The direct mapping is:

```ts
import { StreamTarget } from 'webm-muxer';

let target = new StreamTarget({
    onData: ON_DATA_CALLBACK,
    onHeader: ON_HEADER_CALLBACK,
    onCluster: ON_CLUSTER_CALLBACK,
    chunked: CHUNKED_OPTION,
    chunkSize: CHUNK_SIZE_OPTION
});
```
->
```ts
import { StreamTarget, WebMOutputFormat } from 'mediabunny';

const format = new WebMOutputFormat({
    onSegmentHeader: ON_HEADER_CALLBACK,
    onCluster: ON_CLUSTER_CALLBACK,
});

const target = new StreamTarget(new WritableStream({
    write(chunk) {
        ON_DATA_CALLBACK(chunk.data, chunk.position);
    }
}), {
    chunked: CHUNKED_OPTION,
    chunkSize: CHUNK_SIZE_OPTION,
});
```

### `FileSystemWritableFileStreamTarget`

This class has been removed. Instead, `StreamTarget` now naturally integrates with the File System API:

```ts
import { StreamTarget } from 'mediabunny';

const handle = await window.showSaveFilePicker();
const writableStream = await handle.createWritable();
const target = new StreamTarget(writableStream);
```

With this pattern, there is now no more need to manually close the file stream - `finalize()` will automatically do it for you.

## Subtitle migration

webm-muxer came with its own `SubtitleEncoder`. This is no longer needed, as Mediabunny has built-in sources that handle text-based subtitles.

The old pattern:
```ts
import { Muxer, SubtitleEncoder } from 'webm-muxer';

let muxer = new Muxer({
    subtitles: {
        codec: 'S_TEXT/WEBVTT'
    },
    // ...
});
let subtitleEncoder = new SubtitleEncoder({
    output: (chunk, meta) => muxer.addSubtitleChunk(chunk, meta),
    error: e => console.error(e)
});
subtitleEncoder.configure({ codec: 'webvtt' });
subtitleEncoder.encode(WEBVTT_TEXT);
```

...is replaced by the following pattern in Mediabunny:
```ts
import { Output, TextSubtitleSource } from 'mediabunny';

const output = new Output({ /* ... */ });
const subtitleSource = new TextSubtitleSource('webvtt');
output.addSubtitleTrack(subtitleSource);

await output.start();

await subtitleSource.add(WEBVTT_TEXT);
```

## Other things

### `type` option and Matroska files

The `type` option has been removed. To create a general-purpose Matroska file (`.mkv`), simply use `MkvOutputFormat` instead of `WebMOutputFormat`.

### Codec support

Unlike webm-muxer, Mediabunny is actually *strict* with regard to which codecs it permits within WebM files. It *only* accepts the codecs listed [here](#codec-migration). If you want to use any other codec, you *must* write a Matroska file instead.

### Adding raw data

The previous `addVideoChunkRaw` and `addAudioChunkRaw` methods can now simply be emulated by creating an [`EncodedPacket`](https://mediabunny.dev/guide/packets-and-samples#encodedpacket) from the raw data and passing it to `add` on the respective track source.

### `firstTimestampBehavior`

This option no longer exists. By default, timestamps behave like the old `'permissive'` option. For live media sources like [`MediaStreamVideoTrackSource`](https://mediabunny.dev/guide/media-sources#mediastreamvideotracksource), Mediabunny automatically aligns timestamps using an algorithm called `cross-track-offset`, a feature that was only available in the sister library [mp4-muxer](https://github.com/Vanilagy/mp4-muxer).

### `alpha` and `bitDepth` properties

These properties have been removed from the track options for the following reasons:
- **`alpha`**: The WebCodecs `VideoEncoder` does not support encoding video with an alpha channel, so the option was removed.
- **`bitDepth`**: This option, relevant for PCM codecs, is now automatically determined from the codec string and does not need to be specified.