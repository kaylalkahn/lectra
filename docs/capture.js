/* Builds the MediaStream to record: mic (always) + screen or slide canvas, with audio mixed into one track. */
export function supported() {
  return !!(window.MediaRecorder && navigator.mediaDevices?.getUserMedia);
}
export function screenSupported() {
  return !!navigator.mediaDevices?.getDisplayMedia;
}
export function pickMime() {
  const list = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  return list.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

export class CaptureError extends Error {}

export async function openCapture(mode, deck) {
  const opened = [];
  const track = (s) => { opened.push(s); return s; };
  const cleanup = () => { opened.forEach((s) => s.getTracks().forEach((t) => t.stop())); ac?.close().catch(() => {}); };
  let ac;
  try {
    let mic;
    try { mic = track(await navigator.mediaDevices.getUserMedia({ audio: true })); }
    catch (e) {
      throw new CaptureError(e.name === 'NotFoundError' ? 'No microphone found. Plug one in and try again.'
        : 'Microphone access is needed. Allow it in your browser and try again.');
    }

    let video, extraAudio = [];
    if (mode === 'Slides and voice') {
      video = track(deck.canvas.captureStream(15)).getVideoTracks()[0];
    } else {
      let display;
      try { display = track(await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })); }
      catch (e) {
        throw new CaptureError(e.name === 'NotAllowedError' ? 'Screen sharing was cancelled, so nothing was recorded.'
          : 'Couldn’t start screen sharing in this browser.');
      }
      video = display.getVideoTracks()[0];
      extraAudio = display.getAudioTracks();
    }

    ac = new (window.AudioContext || window.webkitAudioContext)();
    // resume() can hang without user activation, so never wait on it for long
    await Promise.race([ac.resume().catch(() => {}), new Promise((r) => setTimeout(r, 700))]);
    if (ac.state !== 'running') throw new CaptureError('Your browser blocked audio capture. Click the page once and try again.');
    const dest = ac.createMediaStreamDestination();
    ac.createMediaStreamSource(mic).connect(dest);
    if (extraAudio.length) ac.createMediaStreamSource(new MediaStream(extraAudio)).connect(dest);

    const stream = new MediaStream([video, ...dest.stream.getAudioTracks()]);
    return { stream, videoTrack: video, cleanup, hasSystemAudio: extraAudio.length > 0 };
  } catch (e) {
    cleanup();
    throw e;
  }
}
