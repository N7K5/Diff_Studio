export type Source =
  | { kind: 'file'; uri: string; allowMissing?: boolean }
  | { kind: 'git'; repo: string; path: string; ref: string }
  | { kind: 'text'; text: string; label: string };
export interface DocumentState { source: Source; label: string; text: string; savedText: string; version: string; writable: boolean; language: string; exists: boolean; dirty: boolean; initialText?:string; resolvedRef?:string; origin?:Source; archived?:boolean }
export interface Activity { time: string; message: string; kind: 'info' | 'edit' | 'save' }
export interface Session { id: string; title: string; left: DocumentState; right: DocumentState; activity: Activity[]; comments:LineComment[]; archived?:boolean }
export interface CompareRequest { left: Source; right: Source; title?: string }
export interface ChangeEntry { status: string; path: string; oldPath?: string; left: Source; right: Source; sessionId?:string; unavailable?:string }
export interface Settings { layout: 'sideBySide' | 'inline'; ignoreWhitespace: boolean; wordWrap: boolean; hideUnchanged: boolean; fontSize: number; baseBranch: string; maxFileMB: number; sshTimeoutSeconds: number; sidebarAutoHide: boolean; sidebarWidth:number; showTopBar: boolean; showBottomBar: boolean; comparisonHistoryLimit:number; remoteHistoryLimit:number }
export const defaults: Settings = { layout: 'sideBySide', ignoreWhitespace: false, wordWrap: false, hideUnchanged: false, fontSize: 13, baseBranch: '', maxFileMB: 10, sshTimeoutSeconds: 20, sidebarAutoHide: false, sidebarWidth:260, showTopBar: true, showBottomBar: true, comparisonHistoryLimit:10, remoteHistoryLimit:5 };
export interface Revision { ref:string; kind:'branch'|'tag'|'commit'; date:string; subject:string; author?:string }
export interface RevisionPage { refs:Revision[]; commits:Revision[]; hasMore:boolean; nextOffset:number }
export function languageFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return ({ts:'typescript',tsx:'typescript',js:'javascript',jsx:'javascript',mjs:'javascript',cjs:'javascript',json:'json',jsonc:'json',py:'python',rb:'ruby',rs:'rust',go:'go',java:'java',c:'c',h:'cpp',cpp:'cpp',cs:'csharp',html:'html',xml:'xml',css:'css',scss:'scss',md:'markdown',yaml:'yaml',yml:'yaml',sh:'shell',sql:'sql',toml:'ini',ini:'ini',txt:'plaintext'} as Record<string,string>)[ext] || 'plaintext';
}

export interface CommentReply {id:string;body:string;author:'user'|'agent';createdAt:string}
export interface LineComment {id:string;side:"left"|"right";line:number;body:string;anchor:string;outdated:boolean;createdAt:string;updatedAt:string;author?:'user'|'agent';resolved?:boolean;replies?:CommentReply[]}
export interface ComparisonGroup {id:string;label:string;entries:ChangeEntry[]}
export interface HighlightRange {id:string;sessionId:string;side:'left'|'right';startLine:number;endLine:number;label:string;color?:string;commentId?:string;outdated:boolean}
export interface HighlightSet {id:string;label:string;color:string;ranges:HighlightRange[]}
