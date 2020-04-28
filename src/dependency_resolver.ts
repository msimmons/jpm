import { JPMConfig, JPMDependency, POM, POMDependency, POMDependencyManagement, JPMRepository, DependencyScope, ResolvedDependency } from "./models";
import * as UrlHelper from 'url'
import * as PathHelper from 'path'
import * as https from 'https'
import * as fs from 'fs'
import * as xml from 'fast-xml-parser'
import * as he from 'he'

export class DependencyResolver {
    
    private resolveCachedDependency(uri: UrlHelper.Url) : POMDependency[] {
        if (fs.existsSync(uri.path)) {
            let xml = fs.readFileSync(uri.path).toString()
            return this.getTransitiveDependencies(xml)
        }
        else return undefined
    }

    private resolveCachedArtifact(uri: UrlHelper.Url) : string {
        if (fs.existsSync(uri.path)) return uri.path
        else return undefined
    }
    
    private async resolveRemoteDependency(uri: UrlHelper.Url, localPath: string) : Promise<POMDependency[]> {
        return new Promise((resolve, reject) => {
            https.get(uri, (resp => {
                if (resp.statusCode != 200) {
                    console.warn(`Got ${resp.statusCode} for ${uri.path}`)
                    resolve(undefined)
                }
                else {
                    let data = ''
                    resp.on('data', (chunk) => {
                        data += chunk
                    })
                    resp.on('end', () => {
                        fs.mkdirSync(PathHelper.dirname(localPath), {recursive: true})
                        fs.writeFileSync(localPath, data, {flag: "w"})
                        resolve(this.getTransitiveDependencies(data))
                    })
                }
            })).on('error', (err) => {
                console.warn(`${err} trying to get ${uri}`)
                resolve(undefined)
            })
        })
    }

    private async resolveRemoteArtifact(uri: UrlHelper.Url, localPath: string) : Promise<string> {
        return new Promise((resolve, reject) => {
            https.get(uri, (resp => {
                if (resp.statusCode != 200) {
                    console.warn(`Got ${resp.statusCode} for ${uri.path}`)
                    resolve(undefined)
                }
                else {
                    fs.mkdirSync(PathHelper.dirname(localPath), {recursive: true})
                    let fos = fs.createWriteStream(localPath)
                    resp.on('data', (chunk) => {
                        fos.write(chunk)
                    })
                    resp.on('end', () => {
                        fos.close()
                        resolve(localPath)
                    })
                }
            })).on('error', (err) => {
                console.warn(`${err} trying to get ${uri}`)
                resolve(undefined)
            })
        })
    }
    
    private scalarOrArray(dependencies: POMDependency | POMDependency[]) {
        if (Array.isArray(dependencies)) {
            return dependencies
        }
        else return [dependencies]
    }
    
    private replaceProperties(value: string, lookup: any) : string {
        if (!value) return value
        if (!`${value}`.includes('$')) return value
        return value.replace(/\$\{([^\}]*)\}/g, (first, group) => {
            let v = lookup ? lookup[group] : first
            v = v ? v : first
            return v
        })
    }
    
    private bomKey(dep: POMDependency) {
        if (!dep) return undefined
        return `${dep.groupId}:${dep.artifactId}`
    }
    
    private pomKey(dep: POMDependency) {
        return `${dep.groupId}:${dep.artifactId}:${dep.version}`
    }
    
    private getTransitiveDependencies(data: string) : POMDependency[] {
        let json = xml.parse(data, {
            ignoreAttributes: false, 
            attributeNamePrefix:'', 
            textNodeName:'stack', 
            trimValues: true, 
            arrayMode: false,
            attrValueProcessor: (val) => {return he.decode(val)},
            tagValueProcessor: (val) => {return he.decode(val)}
        }) as POM
        let dependencies = []
        if (json.project.dependencies) {
            if (json.project.dependencies.dependency) {
                this.scalarOrArray(json.project.dependencies.dependency).forEach(d => {
                    d.transitive = true
                    d.version = this.replaceProperties(d.version, json.project.properties)
                    dependencies.push(d)
                })
            }
        }
        if (json.project.dependencyManagement) {
            if (json.project.dependencyManagement.dependencies) {
                this.scalarOrArray(json.project.dependencyManagement.dependencies.dependency).forEach(d => {
                    d.bom = true
                    d.version = this.replaceProperties(d.version, json.project.properties)
                    dependencies.push(d)
                })
            }
        }
        return dependencies
    }
    
    private getDependencyPath(dep: POMDependency, extension: string) {
        let groupPath = dep.groupId.replace(/\./g, "/")
        let classifier = dep.classifier ? `-${dep.classifier}` : ''
        return `${groupPath}/${dep.artifactId}/${dep.version}/${dep.artifactId}-${dep.version}${classifier}.${extension}`
    }
    
    private async findPoms(dep: POMDependency, repos: JPMRepository[], localRepo: JPMRepository, parent: POMDependency = undefined) : Promise<POMDependency[]> {
        let path = this.getDependencyPath(dep, 'pom')
        let localUrl = UrlHelper.parse(`${localRepo.uri}/${path}`)
        let resolved : POMDependency[] = undefined
        for (var repo of repos) {
            let uri = UrlHelper.parse(`${repo.uri}/${path}`)
            if (uri.protocol === 'file:') {
                resolved = this.resolveCachedDependency(uri)
                if (resolved) break
            }
            else {
                try {
                    resolved = await this.resolveRemoteDependency(uri, localUrl.path)
                    if (resolved) break
                }
                catch(error) {
                    console.error(error)
                }
            }
        }
        if (resolved) {
            dep.resolved = true
            for (var child of resolved) {
                if (child.type === 'pom' && !child.resolved && this.bomKey(child) != this.bomKey(parent)) {
                    let result = await this.findPoms(child, repos, localRepo, dep)
                    if (result) {
                        child.resolved = true
                        resolved = resolved.concat(result)
                    }
                }
            }
        }
        return resolved
    }
    
    private async findArtifact(dep: POMDependency, repos: JPMRepository[], localRepo: JPMRepository) : Promise<string> {
        let path = this.getDependencyPath(dep, 'jar')
        let localUrl = UrlHelper.parse(`${localRepo.uri}/${path}`)
        let resolved = undefined
        for (var repo of repos) {
            let uri = UrlHelper.parse(`${repo.uri}/${path}`)
            if (uri.protocol === 'file:') {
                resolved = this.resolveCachedArtifact(uri)
                if (resolved) break
            }
            else {
                try {
                    resolved = await this.resolveRemoteArtifact(uri, localUrl.path)
                    if (resolved) break
                }
                catch(error) {
                    console.error(error)
                    resolved = false
                }
            }
        }
        return resolved
    }



    /**
    * Finds all the poms of direct dependencies and collects all the transitive dependencies
    * @param jpmConfig 
    */
    public async resolveDependencies(jpmConfig: JPMConfig) : Promise<POMDependency[]> {
        let dependencyMap = new Map<string, POMDependency>()
        let bomMap = new Map<string, POMDependency>()
        let allRepos = [jpmConfig.localRepository].concat(jpmConfig.repositories)
        for (var d of jpmConfig.dependencies) {
            // Store the dep record
            let pomDependency = {jpmDep: d, groupId: d.group, artifactId: d.artifact, version: d.version, scope: 'compile', bom: d.bom} as POMDependency
            let key = this.pomKey(pomDependency)
            dependencyMap.set(key, pomDependency)
            // Figure out the artifact path
            if (pomDependency.version) {
                let resolved = await this.findPoms(pomDependency, allRepos, jpmConfig.localRepository)
                if (!resolved) {
                    console.error(`Unable to resolve dependency ${key} in any repository`)
                }
                else {
                    resolved.forEach(r => {
                        r.jpmDep = d
                        if (r.bom) bomMap.set(this.bomKey(r), r)
                        else dependencyMap.set(this.pomKey(r), r)
                    })
                }
            }
        }
        Array.from(dependencyMap.entries()).forEach(e => {
            if (!e[1].version) {
                console.log(`Looking for version ${e[1].artifactId}`)
                let bom = bomMap.get(this.bomKey(e[1]))
                if (bom && bom.version) {
                    console.log(`Updating ${e[1].artifactId} to ${bom.version}`)
                    e[1].version = bom.version
                    dependencyMap.delete(e[0])
                    dependencyMap.set(this.pomKey(e[1]), e[1])
                }
            }
        })
        return Array.from(dependencyMap.values())
    }
    
    public async resolveArtifacts(jpmConfig: JPMConfig, dependencies: POMDependency[]) {
        let allRepos = [jpmConfig.localRepository].concat(jpmConfig.repositories)
        let resolved : ResolvedDependency[] = []
        let resolvedDev : ResolvedDependency[] = []
        for (var dep of dependencies) {
            let file = await this.findArtifact(dep, allRepos, jpmConfig.localRepository)
            let sourcesFile = await this.findArtifact({classifier: 'sources', ...dep}, allRepos, jpmConfig.localRepository)
            if (!file) console.error(`Couldn't find ${dep.artifactId} in any repository`)
            else if (dep.scope === 'compile') resolved.push({pomDep: dep, file: file, srcFile: sourcesFile} as ResolvedDependency)
            else resolvedDev.push({pomDep: dep, file: file, srcFile: sourcesFile} as ResolvedDependency)
        }
        let resolvedPath = '.jpm/resolved.json'
        fs.mkdirSync(PathHelper.dirname(resolvedPath), {recursive: true})
        fs.writeFileSync(resolvedPath, JSON.stringify(resolved, undefined, '  '), {flag: 'w'})
    }
    
}