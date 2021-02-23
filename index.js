import * as core from '@actions/core'
import * as github from '@actions/github'
import * as exec from '@actions/exec'
import * as semver from 'semver'
import path from 'path'
import fs from 'fs'

const workspace = process.env.GITHUB_WORKSPACE
const pathToPackage = path.join(workspace, 'package.json')

const validateCommandResults = ({output, error}) => {
  if (error !== '') {
    core.setFailed(`Error getting package.json: ${error}`)
  }

  if (output === '') {
    core.setFailed('Error: package.json is empty')
  }

  return output
}

const execCommand = async (command, args, callback) => {

  let output = ''
  let error = ''
  
  const options = {}
  options.listeners = {
    stdout: (data) => {
      output += data.toString()
    },
    stderr: (data) => {
      error += data.toString()
    }
  }
  
  await exec.exec(command, args, options)

  return callback(validateCommandResults({output, error}))
}

const getPRLabels = async () => {
  try {
    const token = core.getInput('github_token', {required: true})
    const octokit = new github.getOctokit(token)
    const context = github.context

    const { data: pr } = await octokit.pulls.get({
      owner: context.issue.owner,
      repo: context.issue.repo,
      pull_number: context.issue.number
    })

    return pr.labels.map(label => label.name)
  } catch (error) {
    core.setFailed(`Could not retrieve labels: ${error}`)
    return []
  }
}

const setOutputs = (previousVersion, newVersion) => {
  core.setOutput('previous_Version', previousVersion)
  core.setOutput('new_version', newVersion)
}

async function run() {
  try {
    
    const defaultBranch = core.getInput('default_branch')

    const packageJSON = await execCommand('git', ['show', `origin/${defaultBranch}:package.json`], JSON.parse)
    
    const validMajorLabel = core.getInput('major_label')
    const validMinorLabel = core.getInput('minor_label')
    const validPatchLabel = core.getInput('patch_label')

    core.debug(`Valid labels are: ${validMajorLabel}, ${validMinorLabel}, ${validPatchLabel}`)

    const inputMappedToVersion = {
      [validMajorLabel]: 'major',
      [validMinorLabel]: 'minor',
      [validPatchLabel]: 'patch'
    }

    const prLabels = await getPRLabels()
    const versionLabelsOnPR = Object.keys(inputMappedToVersion).filter(
      validLabel => prLabels.includes(validLabel)
    )

    if (!versionLabelsOnPR.length) {
      core.setFailed('No valid version labels on PR')
      return
    }

    if (versionLabelsOnPR.length > 1) {
      core.warning(`More than one version label found on PR. Using ${versionLabelsOnPR[0]}`)
    }

    const releaseType = inputMappedToVersion[versionLabelsOnPR[0]]
    
    core.debug(`Release type: ${releaseType}`)

    const originalVersion = packageJSON.version
    const newVersion = semver.inc(originalVersion, releaseType)
    core.debug(`Bumping ${originalVersion} to ${newVersion}`)

    packageJSON.version = newVersion

    try {
      fs.writeFileSync(pathToPackage, JSON.stringify(packageJSON, null, 2))
    } catch (error) {
      core.setFailed(`Error writing package.json: ${error.message}`)
      return
    }

    setOutputs(originalVersion, newVersion)

  } catch (error) {
    core.setFailed(error);
  }
}

run();
