import server from '../../agent/mcp_server.py';
import transport from '../../scripts/connect_commands.py';
import skill from '../../skills/obsidian-t3/SKILL.md';
import license from '../../LICENSE';
import {contentHash} from '../responses/completion';

/** Reviewed assets for the explicitly selected T3 machine. The agent runtime
 * launches this stdio server; Obsidian does not execute it. */
export const agentAssets={'mcp_server.py':server,'connect_commands.py':transport,'SKILL.md':skill,LICENSE:license};
export const agentBundleHash=contentHash(JSON.stringify(agentAssets));
