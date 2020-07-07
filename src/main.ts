import { platform } from 'os';
import * as core from '@actions/core'
import execa from 'execa'
import { join } from 'path'
import { readFileSync, existsSync, copyFileSync, writeFileSync } from 'fs'

function hasTauriDependency(root: string): boolean {
  const packageJsonPath = join(root, 'package.json')
  if (existsSync(packageJsonPath)) {
    const packageJsonString = readFileSync(packageJsonPath).toString()
    const packageJson = JSON.parse(packageJsonString)
    if (packageJson.dependencies && packageJson.dependencies.tauri) {
      return true
    }
  }
  return false
}

function usesYarn(root: string): boolean {
  return existsSync(join(root, 'yarn.lock'))
}

function execCommand(command: string, { cwd }: { cwd: string | undefined }): Promise<void> {
  console.log(`running ${command}`)
  const [cmd, ...args] = command.split(' ')
  return execa(cmd, args, {
    cwd,
    shell: process.env.shell || true,
    windowsHide: true,
    stdio: 'inherit',
    env: { FORCE_COLOR: '0' },
  }).then()
}

async function buildProject(root: string, args: string[], { configPath, distPath }: { configPath: string | null, distPath: string | null }): Promise<string[]> {
  return new Promise<string>((resolve) => {
    if (hasTauriDependency(root)) {
      const runner = usesYarn(root) ? 'yarn tauri' : 'npx tauri'
      resolve(runner)
    } else {
      execCommand('npm install -g tauri', { cwd: undefined }).then(() => resolve('tauri'))
    }
  })
    .then((runner: string) => {
      if (existsSync(join(root, 'src-tauri'))) {
        return runner
      } else {
        return execCommand(`${runner} init`, { cwd: root }).then(() => runner)
      }
    })
    .then((runner: string) => {
      const tauriConfPath = join(root, 'src-tauri/tauri.conf.json')
      if (configPath !== null) {
        copyFileSync(configPath, tauriConfPath)
      }

      if (distPath) {
        const tauriConf = JSON.parse(readFileSync(tauriConfPath).toString())
        tauriConf.build.distDir = distPath
        writeFileSync(tauriConfPath, JSON.stringify(tauriConf))
      }

      return execCommand(`${runner} build` + (args.length ? ` ${args.join(' ')}` : ''), { cwd: root }).then(() => {
        const appName = 'app'
        const artifactsPath = join(root, 'src-tauri/target/release')

        switch (platform()) {
          case 'darwin':
            return [
              join(artifactsPath, `bundle/dmg/${appName}.dmg`),
              join(artifactsPath, `bundle/osx/${appName}.osx`)
            ]
          case 'win32':
            return [
              join(artifactsPath, `bundle/${appName}.msi`),
            ]
          default:
            return [
              join(artifactsPath, `bundle/deb/${appName}.deb`),
              join(artifactsPath, `bundle/appimage/${appName}.AppImage`)
            ]
        }
      })
    })
}

async function run(): Promise<void> {
  try {
    const projectPath = core.getInput('projectPath') || process.argv[2]
    const configPath = join(projectPath, core.getInput('configPath') || 'tauri.conf.json')
    const distPath = core.getInput('distPath')

    let config = null
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath).toString())
    }

    const artifacts = await buildProject(projectPath, [], { configPath: config, distPath })
    console.log(`artifacts: ${artifacts}`)
    core.setOutput('artifacts', artifacts)
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()