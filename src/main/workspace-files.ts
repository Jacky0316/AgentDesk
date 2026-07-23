import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import type { WorkspaceFileNode, WorkspaceFilePreview } from '../shared/types.js'

const MAX_DEPTH = 4
const MAX_NODES = 500
const MAX_PREVIEW_BYTES = 96_000
const excludedNames = new Set(['.git', 'node_modules', '.next', 'dist', 'out', 'release', 'coverage', '__pycache__'])
const excludedFile = /^(\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx))$/i

function absoluteInside(root: string, projectPath: string): string {
  if (!projectPath || projectPath.includes('\0')) throw new Error('无效的项目文件路径。')
  const target = resolve(root, projectPath)
  const rel = relative(root, target)
  if (rel === '' || rel.startsWith(`..${sep}`) || rel === '..' || /^[a-zA-Z]:/.test(rel)) throw new Error('文件必须位于当前项目根目录内。')
  return target
}

export function listWorkspaceFiles(root: string): WorkspaceFileNode[] {
  let count = 0
  const visit = (relativePath: string, depth: number): WorkspaceFileNode[] => {
    if (depth > MAX_DEPTH || count >= MAX_NODES) return []
    const absolute = relativePath ? absoluteInside(root, relativePath) : root
    const entries = readdirSync(absolute, { withFileTypes: true })
      .filter((entry) => !entry.isSymbolicLink() && !excludedNames.has(entry.name) && !(entry.isFile() && excludedFile.test(entry.name)))
      .sort((left, right) => Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name))
    return entries.map((entry) => {
      count += 1
      const path = relativePath ? `${relativePath}/${entry.name}` : entry.name
      return entry.isDirectory()
        ? { name: entry.name, path, kind: 'directory' as const, children: visit(path, depth + 1) }
        : { name: entry.name, path, kind: 'file' as const }
    })
  }
  return visit('', 0)
}

export function previewWorkspaceFile(root: string, projectPath: string): WorkspaceFilePreview {
  const absolute = absoluteInside(root, projectPath)
  if (lstatSync(absolute).isSymbolicLink()) throw new Error('不支持预览符号链接文件。')
  const bytes = readFileSync(absolute)
  const binary = bytes.includes(0)
  const truncated = bytes.length > MAX_PREVIEW_BYTES
  return { path: projectPath, content: binary ? '此文件为二进制文件，无法在此预览。' : bytes.subarray(0, MAX_PREVIEW_BYTES).toString('utf8'), truncated, binary }
}
