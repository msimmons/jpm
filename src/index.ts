import * as fs from 'fs'
import * as process from 'process'
import * as PathHelper from 'path'
import { spawn } from 'child_process'
import { JPMConfig, ResolvedDependency } from './models'
import { DependencyResolver } from './dependency_resolver'

// Process command line args

// Open the project file
let jpmFile = 'fixture/jpm.json'
if (!fs.existsSync(jpmFile)) {
    console.log(`No project file found at ${jpmFile}`)
    process.exit(1)
}
let data = fs.readFileSync('fixture/jpm.json')
let jpmConfig = JSON.parse(data.toString()) as JPMConfig

let command = process.argv[2]

function replaceProperties(value: string, lookup: any) : string {
    if (!value) return value
    if (!`${value}`.includes('$')) return value
    return value.replace(/\$\{([^\}]*)\}/g, (first, group) => {
        let v = lookup ? lookup[group] : first
        v = v ? v : first
        return v
    })
}

function getClasspath() : string {
    let data = fs.readFileSync('.jpm/resolved.json')
    let resolved = JSON.parse(data.toString()) as ResolvedDependency[]
    return resolved.map(r => r.file).join(':')
}

function getSourceFiles(dir: string) : string[] {
    let entries = fs.readdirSync(dir)
    let sourceFiles = []
    entries.forEach(e => {
        let path = `${dir}/${e}`
        if (fs.statSync(path).isDirectory()) {
            sourceFiles = sourceFiles.concat(getSourceFiles(path))
        }
        else {
            sourceFiles.push(path)
        }
    })
    return sourceFiles
}

function doInstall(config: JPMConfig) {
    let resolver = new DependencyResolver()
    let dependencies = resolver.resolveDependencies(config)
    dependencies.then(dep => {
        resolver.resolveArtifacts(config, dep)
    })
}

// Compile
function doCompile(config: JPMConfig) {
    for (var compiler of config.compilers) {
        console.log(`Compiling with ${compiler.name}`)
        let lookup = {
            ...compiler,
            classpath: getClasspath(),
            sourceFiles: getSourceFiles(compiler.input)
        }
        let args = compiler.args.map(a => {
            return replaceProperties(a, lookup)
        })
        console.log(args)
        let c = spawn(compiler.exec, args)
        c.stdout.on('data', (chunk)=> console.log(chunk.toString()))
        c.stderr.on('data', (chunk)=> console.log(chunk.toString()))
    }
}


// Package
function doPackage(config: JPMConfig) {
    for (var packager of config.packagers) {
        console.log(`Packaging with ${packager.name}`)
        fs.mkdirSync(PathHelper.dirname(packager.output), {recursive: true})
        let lookup = {
            ...packager
        }
        let args = packager.args.map(a => {
            return replaceProperties(a, lookup)
        })
        let c = spawn(packager.exec, args)
        c.stdout.on('data', (chunk) => console.log(chunk.toString()))
        c.stderr.on('data', (chunk) => console.log(chunk.toString()))
    }
}

// Do the requested command
// Install
switch (command) {
    case 'install': doInstall(jpmConfig); break
    case 'compile': doCompile(jpmConfig); break
    case 'package': doPackage(jpmConfig); break
    default: console.error(`Unknown command ${command}`)
}