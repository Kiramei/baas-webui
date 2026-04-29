import '../style/app.css';
import { StreamClientScrcpy } from './StreamClientScrcpy';
import { BroadwayPlayer } from './player/BroadwayPlayer';
import { MsePlayer } from './player/MsePlayer';
import { TinyH264Player } from './player/TinyH264Player';
import { WebCodecsPlayer } from './player/WebCodecsPlayer';

window.onload = async function (): Promise<void> {
    const hash = location.hash.replace(/^#!/, '');
    const parsedQuery = new URLSearchParams(hash);
    const action = parsedQuery.get('action');
    StreamClientScrcpy.registerPlayer(BroadwayPlayer);
    StreamClientScrcpy.registerPlayer(MsePlayer);
    StreamClientScrcpy.registerPlayer(TinyH264Player);
    StreamClientScrcpy.registerPlayer(WebCodecsPlayer);
    if (action === StreamClientScrcpy.ACTION && typeof parsedQuery.get('udid') === 'string') {
        StreamClientScrcpy.start(parsedQuery);
        return;
    }
};
