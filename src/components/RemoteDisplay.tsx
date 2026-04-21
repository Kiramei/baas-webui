// import React, {useEffect, useRef, useState} from "react";
// import {Loader2} from "lucide-react";
// import {CornerBox} from "@/components/ui/cornerbox.tsx";
// import {Modal} from "@/components/ui/Modal.tsx";
// import {t} from "i18next";
// import {useWebSocketStore} from "@/store/websocketStore.ts";
// import {getTimestampMs} from "@/lib/utils.ts";
//
// enum ConnectionStatus {
//   connecting = "connecting",
//   playing = "playing",
// }
//
// type Point = {
//   x: number;
//   y: number;
// };
//
// type GestureState = {
//   active: boolean;
//   pointerId: number | null;
//   startClientX: number;
//   startClientY: number;
//   startPoint: Point | null;
//   lastEmitClientX: number;
//   lastEmitClientY: number;
//   lastEmitPoint: Point | null;
//   startTime: number;
//   lastEmitTime: number;
// };
//
// const TARGET_WIDTH = 1280;
// const TARGET_HEIGHT = 720;
//
// const CLICK_THRESHOLD_PX = 8;
//
// const SWIPE_SEGMENT_THRESHOLD_PX = 150;
//
// const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
//
// export const RemoteDisplay: React.FC<{ profileId: string }> = (
//   {profileId}
// ) => {
//   const canvasRef = useRef<HTMLCanvasElement | null>(null);
//   const canvasHostRef = useRef<HTMLDivElement | null>(null);
//   const statusRef = useRef<HTMLDivElement | null>(null);
//   const modalInteractionRef = useRef<HTMLDivElement | null>(null);
//   const trigger = useWebSocketStore((state) => state.trigger);
//
//   const gestureRef = useRef<GestureState>({
//     active: false,
//     pointerId: null,
//     startClientX: 0,
//     startClientY: 0,
//     startPoint: null,
//     lastEmitClientX: 0,
//     lastEmitClientY: 0,
//     lastEmitPoint: null,
//     startTime: 0,
//     lastEmitTime: 0
//   });
//
//   const [connectionState, setConnectionState] = useState<ConnectionStatus>(ConnectionStatus.connecting);
//   const [modalOpen, setModalOpen] = useState<boolean>(false);
//
//   const emitRemoteEvent = (payload: { [id: string]: any }) => {
//     console.log("[remote-input]", payload);
//     trigger({
//       timestamp: getTimestampMs(),
//       command: "control_device",
//       config_id: profileId,
//       payload: {"operation": payload}
//     }, (response) => {
//       console.debug("start_scheduler acknowledged", response);
//     });
//   };
//
//   const getScaledPointFromClient = (clientX: number, clientY: number): Point | null => {
//     const canvas = canvasRef.current;
//     if (!canvas) return null;
//
//     const rect = canvas.getBoundingClientRect();
//     if (rect.width <= 0 || rect.height <= 0) return null;
//
//     const rx = clamp((clientX - rect.left) / rect.width, 0, 1);
//     const ry = clamp((clientY - rect.top) / rect.height, 0, 1);
//
//     return {
//       x: Math.round(rx * (TARGET_WIDTH - 1)),
//       y: Math.round(ry * (TARGET_HEIGHT - 1)),
//     };
//   };
//
//   const distance2D = (x1: number, y1: number, x2: number, y2: number) => {
//     const dx = x2 - x1;
//     const dy = y2 - y1;
//     return Math.hypot(dx, dy);
//   };
//
//   const resetGesture = () => {
//     gestureRef.current = {
//       active: false,
//       pointerId: null,
//       startClientX: 0,
//       startClientY: 0,
//       startPoint: null,
//       lastEmitClientX: 0,
//       lastEmitClientY: 0,
//       lastEmitPoint: null,
//       startTime: 0,
//       lastEmitTime: 0
//     };
//   };
//
//   const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
//     if (e.pointerType === "mouse" && e.button !== 0) return;
//
//     const point = getScaledPointFromClient(e.clientX, e.clientY);
//     if (!point) return;
//
//     e.preventDefault();
//
//     modalInteractionRef.current?.setPointerCapture?.(e.pointerId);
//     const now = performance.now();
//     gestureRef.current = {
//       active: true,
//       pointerId: e.pointerId,
//       startClientX: e.clientX,
//       startClientY: e.clientY,
//       startPoint: point,
//       lastEmitClientX: e.clientX,
//       lastEmitClientY: e.clientY,
//       lastEmitPoint: point,
//       startTime: now,
//       lastEmitTime: now,
//     };
//   };
//
//   const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
//     const g = gestureRef.current;
//     if (!g.active || g.pointerId !== e.pointerId) return;
//
//     const currentPoint = getScaledPointFromClient(e.clientX, e.clientY);
//     if (!currentPoint || !g.lastEmitPoint) return;
//
//     e.preventDefault();
//
//     const segDist = distance2D(g.lastEmitClientX, g.lastEmitClientY, e.clientX, e.clientY);
//
//     if (segDist >= SWIPE_SEGMENT_THRESHOLD_PX) {
//       const now = performance.now();
//       const dt = now - g.lastEmitTime;
//       g.lastEmitTime = now;
//
//       emitRemoteEvent({
//         type: "swipe",
//         data: {
//           fx: g.lastEmitPoint.x,
//           fy: g.lastEmitPoint.y,
//           tx: currentPoint.x,
//           ty: currentPoint.y,
//           dt: dt
//         },
//       });
//
//       g.lastEmitClientX = e.clientX;
//       g.lastEmitClientY = e.clientY;
//       g.lastEmitPoint = currentPoint;
//     }
//   };
//
//   const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
//     const g = gestureRef.current;
//     if (!g.active || g.pointerId !== e.pointerId || !g.startPoint) {
//       resetGesture();
//       return;
//     }
//
//     const endPoint = getScaledPointFromClient(e.clientX, e.clientY);
//     if (!endPoint) {
//       resetGesture();
//       return;
//     }
//
//     e.preventDefault();
//
//     const totalDist = distance2D(g.startClientX, g.startClientY, e.clientX, e.clientY);
//
//     if (totalDist < CLICK_THRESHOLD_PX) {
//       emitRemoteEvent({
//         type: "click",
//         data: {
//           x: endPoint.x,
//           y: endPoint.y,
//         },
//       });
//     } else if (g.lastEmitPoint) {
//       const remainDist = distance2D(
//         g.lastEmitClientX,
//         g.lastEmitClientY,
//         e.clientX,
//         e.clientY
//       );
//
//       if (remainDist > 0) {
//         const dt = performance.now() - g.startTime;
//         emitRemoteEvent({
//           type: "swipe",
//           data: {
//             fx: g.lastEmitPoint.x,
//             fy: g.lastEmitPoint.y,
//             tx: endPoint.x,
//             ty: endPoint.y,
//             dt: dt
//           },
//         });
//       }
//     }
//
//     try {
//       modalInteractionRef.current?.releasePointerCapture?.(e.pointerId);
//     } catch (_) {
//       // ignore
//     }
//
//     resetGesture();
//   };
//
//   const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
//     try {
//       modalInteractionRef.current?.releasePointerCapture?.(e.pointerId);
//     } catch (_) {
//       // ignore
//     }
//     resetGesture();
//   };
//
//   useEffect(() => {
//     if (canvasRef.current) return;
//
//     const canvas = document.createElement("canvas");
//     canvas.className = "w-full h-full block select-none";
//     canvasRef.current = canvas;
//     canvasHostRef.current?.appendChild(canvas);
//
//     const ctx = canvas.getContext("2d", {
//       alpha: false,
//       desynchronized: true,
//     });
//     if (!ctx) return;
//
//     let decoder: VideoDecoder | null = null;
//     let configured = false;
//     let ts = 0;
//     let ws: WebSocket | null = null;
//
//     const b64ToU8 = (b64: string) => {
//       const bin = atob(b64);
//       const u8 = new Uint8Array(bin.length);
//       for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
//       return u8;
//     };
//
//     const setupDecoder = (msg: { description: string; codec: string }) => {
//       const desc = b64ToU8(msg.description);
//
//       if (decoder) {
//         try {
//           decoder.close();
//         } catch (_) {
//         }
//       }
//
//       decoder = new VideoDecoder({
//         output: (frame) => {
//           const sw = frame.visibleRect?.width ?? frame.displayWidth ?? frame.codedWidth;
//           const sh = frame.visibleRect?.height ?? frame.displayHeight ?? frame.codedHeight;
//           const sx = frame.visibleRect?.x ?? 0;
//           const sy = frame.visibleRect?.y ?? 0;
//
//           if (canvas.width !== sw) canvas.width = sw;
//           if (canvas.height !== sh) canvas.height = sh;
//
//           ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, sw, sh);
//
//           frame.close();
//           setConnectionState(ConnectionStatus.playing);
//         },
//         error: (e) => {
//           console.error("decoder error", e);
//           if (statusRef.current) statusRef.current.textContent = "Decoder Error (Console)";
//         },
//       });
//
//       decoder.configure({
//         codec: msg.codec,
//         description: desc,
//         optimizeForLatency: true,
//       });
//
//       ts = 0;
//       configured = true;
//       if (statusRef.current) statusRef.current.textContent = "Configured: " + msg.codec;
//     };
//
//     const connect = () => {
//       ws = new WebSocket(`ws://127.0.0.1:8000/ws`);
//       ws.binaryType = "arraybuffer";
//
//       let needKeyframe = true;
//
//       ws.onopen = () => {
//         if (statusRef.current) statusRef.current.textContent = "connected";
//         ws?.send("config?");
//       };
//
//       ws.onclose = () => {
//         if (statusRef.current) statusRef.current.textContent = "closed (retrying...)";
//         configured = false;
//         if (decoder) {
//           try {
//             decoder.close();
//           } catch (_) {
//           }
//           decoder = null;
//         }
//         setTimeout(connect, 800);
//       };
//
//       ws.onerror = (e) => {
//         console.error("ws error", e);
//         if (statusRef.current) statusRef.current.textContent = "ws error (console)";
//       };
//
//       ws.onmessage = (ev) => {
//         if (typeof ev.data === "string") {
//           const msg = JSON.parse(ev.data);
//           if (msg.type === "config") {
//             setupDecoder(msg);
//             needKeyframe = true;
//           }
//           return;
//         }
//
//         if (!configured || !decoder) return;
//
//         const buf = new Uint8Array(ev.data);
//         const isKey = buf[0] === 1;
//         const data = buf.subarray(1);
//
//         if (needKeyframe) {
//           if (!isKey) return;
//           needKeyframe = false;
//         }
//
//         try {
//           decoder.decode(
//             new EncodedVideoChunk({
//               type: isKey ? "key" : "delta",
//               timestamp: ts,
//               data,
//             })
//           );
//           ts += 33333;
//         } catch (e) {
//           console.error("decode throw", e);
//         }
//       };
//     };
//
//     connect();
//
//     return () => {
//       ws?.close();
//       decoder?.close();
//       setConnectionState(ConnectionStatus.connecting);
//     };
//   }, []);
//
//   useEffect(() => {
//     const canvas = canvasRef.current;
//     if (!canvas) return;
//
//     if (modalOpen) {
//       const modalMount = document.getElementById("remote-ctrl-mount");
//       if (modalMount && canvas.parentNode !== modalMount) {
//         modalMount.appendChild(canvas);
//       }
//     } else {
//       const host = canvasHostRef.current;
//       if (host && canvas.parentNode !== host) {
//         host.appendChild(canvas);
//       }
//     }
//   }, [modalOpen]);
//
//   const onCloseModal = () => {
//     setModalOpen(false);
//   };
//
//   const openModalView = () => {
//     setModalOpen(true);
//   };
//
//   return (
//     <div
//       className="absolute bg-black w-64 h-36 right-5 top-3 rounded-xl m-4 overflow-hidden border-2 border-gray-500 z-10">
//       {connectionState === ConnectionStatus.playing && (
//         <div
//           onClick={openModalView}
//           className="absolute h-full w-full hover:bg-[#000000]/30 hover:backdrop-blur-[3px] transition"
//         >
//           <div className="absolute group/outer w-full h-full flex cursor-pointer z-10">
//             <CornerBox
//               size={40}
//               cornerSize={15}
//               borderWidth={3}
//               expand={8}
//               className="m-auto"
//             />
//           </div>
//         </div>
//       )}
//
//       {connectionState === ConnectionStatus.connecting && (
//         <div className="absolute w-full h-full">
//           <div className="flex flex-col h-full items-center justify-center text-white">
//             <Loader2 className="animate-spin h-10 w-10 mb-2"/>
//             <div ref={statusRef} className="text-xs text-white z-10">
//               Connecting...
//             </div>
//           </div>
//         </div>
//       )}
//
//       <div ref={canvasHostRef} className="w-full h-full"/>
//
//       <Modal
//         isOpen={modalOpen}
//         title={t("remote.emulator")}
//         onClose={onCloseModal}
//         width={95}
//       >
//         <div className="relative w-full max-w-full select-none">
//           <div
//             id="remote-ctrl-mount"
//             className="w-full aspect-video bg-black overflow-hidden"
//           />
//           <div
//             ref={modalInteractionRef}
//             className="absolute inset-0 z-20"
//             style={{touchAction: "none"}}
//             onPointerDown={handlePointerDown}
//             onPointerMove={handlePointerMove}
//             onPointerUp={handlePointerUp}
//             onPointerCancel={handlePointerCancel}
//           />
//         </div>
//       </Modal>
//     </div>
//   );
// };


import React, {useEffect, useRef, useState} from "react";
import {Loader2} from "lucide-react";
import {CornerBox} from "@/components/ui/cornerbox.tsx";
import {Modal} from "@/components/ui/Modal.tsx";
import {t} from "i18next";
import {useWebSocketStore} from "@/store/websocketStore.ts";
import {getTimestampMs} from "@/lib/utils.ts";
import {WsName} from "@/types/app";
import {H264WebSocketDecoder} from "@/lib/h264.ts";

/**
 * Connection state used by the UI layer.
 *
 * - connecting: the player is waiting for a valid decoder configuration
 *   or for the first successfully rendered frame.
 * - playing: the decoder has already rendered at least one frame.
 */
enum ConnectionStatus {
  connecting = "connecting",
  playing = "playing",
}

/**
 * A 2D point in the target device coordinate system.
 */
type Point = {
  x: number;
  y: number;
};

/**
 * Mutable gesture tracking state stored in a ref.
 *
 * This structure is intentionally kept outside React state because
 * pointer move events can be very frequent, and we do not want to
 * trigger re-renders for every intermediate pointer update.
 */
type GestureState = {
  active: boolean;
  pointerId: number | null;
  startClientX: number;
  startClientY: number;
  startPoint: Point | null;
  lastEmitClientX: number;
  lastEmitClientY: number;
  lastEmitPoint: Point | null;
  startTime: number;
  lastEmitTime: number;
};

/**
 * Target resolution used by the remote input mapping layer.
 *
 * Pointer coordinates collected on the modal overlay are scaled into
 * this virtual device coordinate system before being sent to the backend.
 */
const TARGET_WIDTH = 1280;
const TARGET_HEIGHT = 720;

/**
 * Maximum pointer movement, in CSS pixels, that is still considered a click.
 */
const CLICK_THRESHOLD_PX = 8;

/**
 * Minimum pointer travel, in CSS pixels, required before emitting another
 * swipe segment while the pointer is moving.
 *
 * A larger threshold reduces traffic, while a smaller threshold produces
 * denser swipe trajectories.
 */
const SWIPE_SEGMENT_THRESHOLD_PX = 150;

/**
 * Clamp a numeric value into the closed interval [min, max].
 */
const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

/**
 * Remote display component.
 *
 * This component is responsible for:
 * 1. Maintaining a WebSocket connection to receive encoded video.
 * 2. Initializing and driving a WebCodecs VideoDecoder instance.
 * 3. Rendering decoded frames into a detached canvas element.
 * 4. Moving the same canvas between the thumbnail host and the modal host.
 * 5. Capturing pointer gestures on the modal overlay and forwarding them
 *    to the backend as normalized remote-control events.
 */
export const RemoteDisplay: React.FC<{ profileId: string }> = ({profileId}) => {
  /**
   * The actual rendering canvas is created imperatively and stored in a ref.
   * We do this to keep the same canvas element alive when it is moved between
   * the inline preview container and the modal container.
   */
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  /**
   * Host node for the inline thumbnail view.
   */
  const canvasHostRef = useRef<HTMLDivElement | null>(null);

  /**
   * Small textual status area shown while connecting or on transient failures.
   */
  const statusRef = useRef<HTMLDivElement | null>(null);

  /**
   * Invisible pointer-capture layer placed above the modal canvas.
   * All remote input gestures are collected from this element.
   */
  const modalInteractionRef = useRef<HTMLDivElement | null>(null);

  /**
   * Action dispatcher used by the remote control channel.
   */
  const trigger = useWebSocketStore((state) => state.trigger);
  const connectRemote = useWebSocketStore((state) => state.connectRemote);
  const disconect = useWebSocketStore((state) => state.disconnect)

  /**
   * Mutable gesture state.
   */
  const gestureRef = useRef<GestureState>({
    active: false,
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    startPoint: null,
    lastEmitClientX: 0,
    lastEmitClientY: 0,
    lastEmitPoint: null,
    startTime: 0,
    lastEmitTime: 0,
  });

  /**
   * UI-level connection state.
   */
  const [connectionState, setConnectionState] = useState<ConnectionStatus>(
    ConnectionStatus.connecting
  );

  /**
   * Modal visibility state.
   */
  const [modalOpen, setModalOpen] = useState<boolean>(false);

  const [sockName, setSockName] = useState<WsName>("remote-null");

  /**
   * Send a remote input operation to the backend.
   *
   * The payload shape is intentionally kept aligned with your existing
   * backend command channel contract.
   */
  const emitRemoteEvent = (payload: Record<string, unknown>): void => {
    console.log("[remote-input]", payload);

    trigger(
      {
        timestamp: getTimestampMs(),
        command: "control_device",
        config_id: profileId,
        payload: {
          operation: payload,
        },
      },
      (response) => {
        console.debug("control_device acknowledged", response);
      }
    );
  };

  /**
   * Convert a client-space pointer coordinate into the target device space.
   *
   * The coordinate is normalized against the canvas bounding rectangle and
   * then scaled into the fixed target resolution.
   */
  const getScaledPointFromClient = (
    clientX: number,
    clientY: number
  ): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const normalizedX = clamp((clientX - rect.left) / rect.width, 0, 1);
    const normalizedY = clamp((clientY - rect.top) / rect.height, 0, 1);

    return {
      x: Math.round(normalizedX * (TARGET_WIDTH - 1)),
      y: Math.round(normalizedY * (TARGET_HEIGHT - 1)),
    };
  };

  /**
   * Euclidean distance in 2D.
   */
  const distance2D = (
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): number => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.hypot(dx, dy);
  };

  /**
   * Reset all pointer tracking state to its inactive form.
   */
  const resetGesture = (): void => {
    gestureRef.current = {
      active: false,
      pointerId: null,
      startClientX: 0,
      startClientY: 0,
      startPoint: null,
      lastEmitClientX: 0,
      lastEmitClientY: 0,
      lastEmitPoint: null,
      startTime: 0,
      lastEmitTime: 0,
    };
  };

  /**
   * Begin a new gesture session.
   *
   * Only the primary mouse button is accepted for mouse input.
   */
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const point = getScaledPointFromClient(event.clientX, event.clientY);
    if (!point) return;

    event.preventDefault();

    modalInteractionRef.current?.setPointerCapture?.(event.pointerId);

    const now = performance.now();
    gestureRef.current = {
      active: true,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPoint: point,
      lastEmitClientX: event.clientX,
      lastEmitClientY: event.clientY,
      lastEmitPoint: point,
      startTime: now,
      lastEmitTime: now,
    };
  };

  /**
   * Track an active gesture and emit swipe segments incrementally.
   *
   * This design keeps swipe reporting reasonably dense without sending
   * a network event for every single pointer move.
   */
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const gesture = gestureRef.current;
    if (!gesture.active || gesture.pointerId !== event.pointerId) return;

    const currentPoint = getScaledPointFromClient(event.clientX, event.clientY);
    if (!currentPoint || !gesture.lastEmitPoint) return;

    event.preventDefault();

    const segmentDistance = distance2D(
      gesture.lastEmitClientX,
      gesture.lastEmitClientY,
      event.clientX,
      event.clientY
    );

    if (segmentDistance >= SWIPE_SEGMENT_THRESHOLD_PX) {
      const now = performance.now();
      const deltaTimeMs = now - gesture.lastEmitTime;
      gesture.lastEmitTime = now;

      emitRemoteEvent({
        type: "swipe",
        data: {
          fx: gesture.lastEmitPoint.x,
          fy: gesture.lastEmitPoint.y,
          tx: currentPoint.x,
          ty: currentPoint.y,
          dt: deltaTimeMs,
        },
      });

      gesture.lastEmitClientX = event.clientX;
      gesture.lastEmitClientY = event.clientY;
      gesture.lastEmitPoint = currentPoint;
    }
  };

  /**
   * Finalize a gesture.
   *
   * If the total travel distance is below the click threshold, emit a click.
   * Otherwise, emit the final swipe segment if there is any remaining motion.
   */
  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const gesture = gestureRef.current;

    if (!gesture.active || gesture.pointerId !== event.pointerId || !gesture.startPoint) {
      resetGesture();
      return;
    }

    const endPoint = getScaledPointFromClient(event.clientX, event.clientY);
    if (!endPoint) {
      resetGesture();
      return;
    }

    event.preventDefault();

    const totalDistance = distance2D(
      gesture.startClientX,
      gesture.startClientY,
      event.clientX,
      event.clientY
    );

    if (totalDistance < CLICK_THRESHOLD_PX) {
      emitRemoteEvent({
        type: "click",
        data: {
          x: endPoint.x,
          y: endPoint.y,
        },
      });
    } else if (gesture.lastEmitPoint) {
      const remainingDistance = distance2D(
        gesture.lastEmitClientX,
        gesture.lastEmitClientY,
        event.clientX,
        event.clientY
      );

      if (remainingDistance > 0) {
        /**
         * This preserves your original behavior:
         * the final segment duration is measured from gesture start time
         * rather than from the last emitted segment.
         *
         * If you later want segment-local timing instead, change this to:
         * performance.now() - gesture.lastEmitTime
         */
        const totalDurationMs = performance.now() - gesture.startTime;

        emitRemoteEvent({
          type: "swipe",
          data: {
            fx: gesture.lastEmitPoint.x,
            fy: gesture.lastEmitPoint.y,
            tx: endPoint.x,
            ty: endPoint.y,
            dt: totalDurationMs,
          },
        });
      }
    }

    try {
      modalInteractionRef.current?.releasePointerCapture?.(event.pointerId);
    } catch {
      /**
       * Pointer capture release can fail harmlessly if capture was already lost.
       */
    }

    resetGesture();
  };

  /**
   * Abort gesture tracking on pointer cancellation.
   */
  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>): void => {
    try {
      modalInteractionRef.current?.releasePointerCapture?.(event.pointerId);
    } catch {
      /**
       * Ignore pointer capture release failures during cancellation.
       */
    }

    resetGesture();
  };

  /**
   * Initialize canvas, WebSocket, and VideoDecoder exactly once.
   *
   * This effect intentionally creates the canvas imperatively and keeps the
   * decoder state local to the effect, because the decoder lifecycle should
   * be tightly coupled to the socket session rather than to React re-renders.
   */
  useEffect(() => {
    if (canvasRef.current) return;

    const canvas = document.createElement("canvas");
    canvas.className = "w-full h-full block select-none";
    canvasRef.current = canvas;
    canvasHostRef.current?.appendChild(canvas);
    const decoder = new H264WebSocketDecoder(canvas);

    let configured = false;
    let timestampUs = 0;
    let reconnectTimer: number | null = null;


    /**
     * Establish the WebSocket session and bind all event handlers.
     *
     * The protocol preserved here matches your earlier implementation:
     * - send "config?" after connection
     * - wait for a textual config message
     * - then accept binary chunks with a 1-byte keyframe flag prefix
     */
    const connect = async (): Promise<void> => {
      /**
       * The decoder must start from a key frame after each configuration
       * or reconnection event.
       */
      let needKeyFrame = true;

      const _sockName = await connectRemote(
        profileId,
        (_) => {
          if (statusRef.current) {
            statusRef.current.textContent = "connected";
          }
        },

        (_) => {
          if (statusRef.current) {
            statusRef.current.textContent = "closed (retrying...)";
          }

          configured = false;

          if (decoder) {
            try {
              decoder.close();
            } catch {
              /**
               * Ignore close failures during socket shutdown.
               */
            }
          }

          reconnectTimer = window.setTimeout(connect, 800);
        },

        (error) => {
          console.error("ws error", error);
          if (statusRef.current) {
            statusRef.current.textContent = "WebSocket Error (see console)";
          }
        },

        (data: ArrayBuffer) => {
          /**
           * Text messages are reserved for configuration/control metadata.
           */
          // if (!configured || !decoder) return;
          console.log(data);

          const view = new DataView(data);
          if (view.byteLength <= 1) return;
          const isKeyFrame = view.getUint8(0) === 1;
          const pts = Number(view.getBigUint64(1, false));
          const encodedData = new Uint8Array(data, 9);
          /**
           * After reconnecting or reconfiguring, decoding must not begin from a
           * delta frame because reference state is not yet available.
           */
          if (needKeyFrame) {
            if (!isKeyFrame) return;
            needKeyFrame = false;
          }

          try {
            decoder.decode(
              encodedData,
              isKeyFrame,
              pts
            );

            timestampUs += pts;
          } catch (error) {
            console.error("decode throw", error);
          }
        });
      setSockName(_sockName);
    };

    connect().then(_ => undefined);

    return () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      disconect(sockName)
      if (decoder) {
        try {
          decoder.close();
        } catch {
          /**
           * Ignore decoder close failures during component unmount.
           */
        }
      }

      setConnectionState(ConnectionStatus.connecting);
    };
  }, []);

  /**
   * Move the persistent canvas node between the inline preview container and
   * the modal container whenever the modal visibility changes.
   *
   * This approach avoids recreating the canvas and losing decoder output state.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (modalOpen) {
      const modalMount = document.getElementById("remote-ctrl-mount");
      if (modalMount && canvas.parentNode !== modalMount) {
        modalMount.appendChild(canvas);
      }
    } else {
      const host = canvasHostRef.current;
      if (host && canvas.parentNode !== host) {
        host.appendChild(canvas);
      }
    }
  }, [modalOpen]);

  /**
   * Close the enlarged modal view.
   */
  const onCloseModal = (): void => {
    setModalOpen(false);
  };

  /**
   * Open the enlarged modal view.
   */
  const openModalView = (): void => {
    setModalOpen(true);
  };

  return (
    <div
      className="absolute bg-black w-64 h-36 right-5 top-3 rounded-xl m-4 overflow-hidden border-2 border-gray-500 z-10">
      {connectionState === ConnectionStatus.playing && (
        <div
          onClick={openModalView}
          className="absolute h-full w-full hover:bg-[#000000]/30 hover:backdrop-blur-[3px] transition"
        >
          <div className="absolute group/outer w-full h-full flex cursor-pointer z-10">
            <CornerBox
              size={40}
              cornerSize={15}
              borderWidth={3}
              expand={8}
              className="m-auto"
            />
          </div>
        </div>
      )}

      {connectionState === ConnectionStatus.connecting && (
        <div className="absolute w-full h-full">
          <div className="flex flex-col h-full items-center justify-center text-white">
            <Loader2 className="animate-spin h-10 w-10 mb-2"/>
            <div ref={statusRef} className="text-xs text-white z-10">
              Connecting...
            </div>
          </div>
        </div>
      )}

      <div ref={canvasHostRef} className="w-full h-full"/>

      <Modal
        isOpen={modalOpen}
        title={t("remote.emulator")}
        onClose={onCloseModal}
        width={95}
      >
        <div className="relative w-full max-w-full select-none">
          <div
            id="remote-ctrl-mount"
            className="w-full aspect-video bg-black overflow-hidden"
          />
          <div
            ref={modalInteractionRef}
            className="absolute inset-0 z-20"
            style={{touchAction: "none"}}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
          />
        </div>
      </Modal>
    </div>
  );
};