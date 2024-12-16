// 用户配置区域开始 =================================

// GitLab 仓库配置列表，包含仓库名称、ID 和访问 Token
const GITLAB_CONFIGS = [
  { name: 'repo1', id: 'repoID1', token: 'repoToken1' },  // 节点1配置
  { name: 'repo2', id: 'repoID2', token: 'repoToken2' },  // 节点2配置
  { name: 'repo3', id: 'repoID3', token: 'repoToken3' },  // 节点3配置
  { name: 'repo4', id: 'repoID4', token: 'repoToken4' },  // 节点4配置
];

// GitHub 仓库列表，留空表示与 GitLab 的仓库名称一致
const GITHUB_REPOS = [''];  // 如果需要指定 GitHub 仓库名，可以在此处填写。如果 GitHub 节点与 GitLab 不一样，可以用 ['ghRepo1','ghRepo2','ghRepo3','ghRepo4']

// GitHub 用户名和个人访问令牌（PAT）
const GITHUB_USERNAME = '';  // 填写 GitHub 用户名
const GITHUB_PAT = '';      // 填写 GitHub 访问令牌

// 定义集群访问目录
const DIR = ''; // 存储的文件目录，可以为空，表示根目录

// 定义集群里全部节点连接状态的密码验证，区分大小写（优先使用自定义密码，若为空则使用 GITHUB_PAT）
const CHECK_PASSWORD = '' || GITHUB_PAT;

// 定义全局缓存时间，单位为秒，默认值为一年（31556952秒）
const CACHE_MAX_AGE = 31556952; // 一年

// GitHub 备份策略
const STRATEGY = 'size'  // 可选 [size (默认) | quantity | 指定节点]; size: 选择容量最少的仓库来存储文件; quantity: 选择文件最少的仓库来存储文件; 指定节点: 比如  pic1 或者 pic2
const DELETE = 'true'  // 可选 [true (默认) | false]，已复制到 GitHub 的文件，是否从 R2 删除

// 用户配置区域结束 =================================

// Cloudflare Worker 主函数，处理 HTTP 请求
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url); // 获取请求的 URL
    const from = url.searchParams.get('from')?.toLowerCase(); // 获取来源参数

    // 只在没有 from 参数时才检查和使用缓存
    let cacheResponse;
    if (!from) {
      const cacheUrl = new URL(request.url); // 获取请求 URL 的对象表示
      const cacheKey = new Request(cacheUrl.toString(), request);
      const cache = caches.default;
      cacheResponse = await cache.match(cacheKey);

      if (cacheResponse) {
        // 如果有缓存，直接返回缓存内容
        return cacheResponse;
      }
    }

    // 直接使用 GITLAB_CONFIGS 中的 name 作为 GitHub 仓库名
    const githubRepos = GITLAB_CONFIGS.map(config => config.name);

    const FILE = url.pathname.split('/').pop(); // 获取请求文件名

    if (url.pathname === `/${CHECK_PASSWORD}`) {
      const result = await listProjects(GITLAB_CONFIGS, githubRepos, GITHUB_USERNAME, GITHUB_PAT);
      // 如果有 from 参数，添加禁止缓存的头部
      if (from) {
        result.headers.append('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        result.headers.append('Pragma', 'no-cache');
        result.headers.append('Expires', '0');
      } else {
        result.headers.append('Cache-Control', `public, max-age=${CACHE_MAX_AGE}`);
        const cacheUrl = new URL(request.url);
        const cacheKey = new Request(cacheUrl.toString(), request);
        const cache = caches.default;
        ctx.waitUntil(cache.put(cacheKey, result.clone())); // 异步存入缓存
      }
      return result;
    }

    const startTime = Date.now(); // 记录请求开始时间
    let requests = []; // 初始化请求数组

    // 构建 API 请求数组，根据请求来源（GitHub 或 GitLab 或混合）
    if (from === 'where') {
      // 获取文件信息模式
      const githubRequests = githubRepos.map(repo => ({
        url: `https://api.github.com/repos/${GITHUB_USERNAME}/${repo}/contents/${DIR}/${FILE}`,
        headers: {
          'Authorization': `token ${GITHUB_PAT}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Cloudflare Worker'
        },
        source: 'github',
        repo: repo,
        processResponse: async (response) => {
          if (!response.ok) throw new Error('Not found')
          const data = await response.json()
          return {
            size: data.size,
            exists: true
          }
        }
      }))

      const gitlabRequests = GITLAB_CONFIGS.map(config => ({
        url: `https://gitlab.com/api/v4/projects/${config.id}/repository/files/${encodeURIComponent(`${DIR}/${FILE}`)}?ref=main`,
        headers: {
          'PRIVATE-TOKEN': config.token
        },
        source: 'gitlab',
        repo: config.name,
        processResponse: async (response) => {
          if (!response.ok) throw new Error('Not found')
          const data = await response.json()
          const size = atob(data.content).length
          return {
            size: size,
            exists: true
          }
        }
      }))

      requests = [...githubRequests, ...gitlabRequests]
    } else {
      // 获取文件内容模式
      if (from === 'github') {
        requests = githubRepos.map(repo => ({
          url: `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${repo}/main/${DIR}/${FILE}`,
          headers: {
            'Authorization': `token ${GITHUB_PAT}`,
            'User-Agent': 'Cloudflare Worker'
          },
          source: 'github',
          repo: repo
        }))
      } else if (from === 'gitlab') {
        requests = GITLAB_CONFIGS.map(config => ({
          url: `https://gitlab.com/api/v4/projects/${config.id}/repository/files/${encodeURIComponent(`${DIR}/${FILE}`)}/raw?ref=main`,
          headers: {
            'PRIVATE-TOKEN': config.token
          },
          source: 'gitlab',
          repo: config.name
        }))
      } else {
        requests = [
          ...githubRepos.map(repo => ({
            url: `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${repo}/main/${DIR}/${FILE}`,
            headers: {
              'Authorization': `token ${GITHUB_PAT}`,
              'User-Agent': 'Cloudflare Worker'
            },
            source: 'github',
            repo: repo
          })),
          ...GITLAB_CONFIGS.map(config => ({
            url: `https://gitlab.com/api/v4/projects/${config.id}/repository/files/${encodeURIComponent(`${DIR}/${FILE}`)}/raw?ref=main`,
            headers: {
              'PRIVATE-TOKEN': config.token
            },
            source: 'gitlab',
            repo: config.name
          }))
        ]
      }
    }

    const fetchPromises = requests.map(({ url, headers, source, repo, processResponse }) => {
      return fetch(new Request(url, {
        method: 'GET',
        headers: headers
      })).then(async response => {
        if (from === 'where') {
          // 查询文件所在位置
          try {
            const result = await processResponse(response);
            const endTime = Date.now(); // 记录请求结束时间
            const duration = endTime - startTime; // 计算请求耗时

            // 格式化文件大小
            const formattedSize = result.size > 1024 * 1024
              ? `${(result.size / (1024 * 1024)).toFixed(2)} MB`
              : `${(result.size / 1024).toFixed(2)} kB`;

            // 返回文件信息
            return {
              fileName: FILE,
              size: formattedSize,
              source: `${source} (${repo})`,
              duration: `${duration}ms`
            };
          } catch (error) {
            throw new Error(`Not found in ${source} (${repo})`);
          }
        } else {
          // 如果不是 "where" 查询，直接返回响应内容
          if (!response.ok) {
            throw new Error(`Not found in ${source} (${repo})`);
          }
          return response;
        }
      }).catch(error => {
        throw new Error(`Error in ${source} (${repo}): ${error.message}`);
      });
    });

    try {
      if (requests.length === 0) {
        throw new Error('No valid source specified');
      }

      const result = await Promise.any(fetchPromises);

      let response;
      if (from === 'where') {
        // 如果是 where 查询，返回 JSON 格式响应
        response = new Response(JSON.stringify(result, null, 2), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          }
        });
      } else if (result instanceof Response) {
        // 先读取响应体
        const blob = await result.blob();
        const headers = {
          'Content-Type': result.headers.get('Content-Type') || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*'
        };

        // 如果有 from 参数，添加禁止缓存的头部
        if (from) {
          headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate';
          headers['Pragma'] = 'no-cache';
          headers['Expires'] = '0';
        } else {
          // 如果没有 from 参数，使用配置的缓存时间
          headers['Cache-Control'] = `public, max-age=${CACHE_MAX_AGE}`;
        }

        // 创建新的响应，只使用最基本的必要头部 
        response = new Response(blob, {
          status: 200,
          headers: headers
        });
      } else {
        throw new Error("Unexpected result type");
      }

      // 只在没有 from 参数且不是 where 查询时才缓存响应
      if (!from && from !== 'where') {
        const cacheUrl = new URL(request.url);
        const cacheKey = new Request(cacheUrl.toString(), request);
        const cache = caches.default;
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }

      return response;

    } catch (error) {
      const sourceText = from === 'where'
        ? 'in any repository'
        : from
          ? `from ${from}`
          : 'in the GitHub and GitLab picture cluster';

      const errorResponse = new Response(
        `404: Cannot find the ${FILE} ${sourceText}.`,
        {
          status: 404,
          headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          }
        }
      );

      return errorResponse;
    }
  }
}

// 列出所有节点仓库状态
async function listProjects(gitlabConfigs, githubRepos, githubUsername, githubPat) {

  let result = 'GitHub and GitLab Nodes status:\n\n';

  try {
    // 并发执行所有检查
    const [username, ...allChecks] = await Promise.all([
      getGitHubUsername(githubPat),
      ...githubRepos.map(repo =>
        checkGitHubRepo(githubUsername, repo, githubPat)
      ),
      ...gitlabConfigs.map(config =>
        checkGitLabProject(config.id, config.token)
      ),
    ]);

    // 计算各类检查结果的数量
    const githubCount = githubRepos.length;
    const gitlabCount = gitlabConfigs.length;

    // 分割检查结果
    const githubResults = allChecks.slice(0, githubCount);
    const gitlabResults = allChecks.slice(githubCount, githubCount + gitlabCount);

    // 添加 GitHub 结果
    githubRepos.forEach((repo, index) => {
      const [status, fileCount, totalSize] = githubResults[index];
      const formattedSize = formatSize(totalSize);
      result += `GitHub: ${repo} - ${status} (Username: ${username}, Files: ${fileCount}, Size: ${formattedSize})\n`;
    });

    // 添加 GitLab 结果
    gitlabConfigs.forEach((config, index) => {
      const [status, username, fileCount] = gitlabResults[index];
      result += `GitLab: Project ID ${config.id} - ${status} (Username: ${username}, Files: ${fileCount})\n`;
    });

  } catch (error) {
    result += `Error during status check: ${error.message}\n`;
  }

  return new Response(result, {
    headers: { 'Content-Type': 'text/plain' }
  });
}

// 文件大小格式化函数
function formatSize(sizeInBytes) {
  if (sizeInBytes >= 1024 * 1024 * 1024) {
    return `${(sizeInBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  } else if (sizeInBytes >= 1024 * 1024) {
    return `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`;
  } else {
    return `${(sizeInBytes / 1024).toFixed(2)} kB`;
  }
}

// 获取 GitHub 用户名的异步函数
async function getGitHubUsername(pat) {
  const url = 'https://api.github.com/user';  // GitHub 用户信息 API 地址
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${pat}`,  // 使用个人访问令牌进行授权
        'Accept': 'application/vnd.github.v3+json',  // 指定接受的响应格式
        'User-Agent': 'Cloudflare Worker'  // 用户代理
      }
    });

    // 如果响应状态为 200，表示成功
    if (response.status === 200) {
      const data = await response.json();  // 解析 JSON 数据
      return data.login;  // 返回用户登录名
    } else {
      console.error('GitHub API Error:', response.status);  // 记录错误状态
      return 'Unknown';  // 返回未知状态
    }
  } catch (error) {
    console.error('GitHub request error:', error);  // 记录请求错误
    return 'Error';  // 返回错误状态
  }
}

// 检查 GitHub 仓库的异步函数
async function checkGitHubRepo(owner, repo, pat) {
  const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;
  const contentsUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${DIR}`; // 直接检查指定目录

  const headers = {
    'Authorization': `token ${pat}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Cloudflare Worker'
  };

  try {
    // 并发请求获取仓库信息和目录内容
    const [repoResponse, contentsResponse] = await Promise.all([
      fetch(repoUrl, { headers }),
      fetch(contentsUrl, { headers })
    ]);

    const repoData = await repoResponse.json();

    if (repoResponse.status !== 200) {
      throw new Error(`Repository error: ${repoData.message}`);
    }

    if (contentsResponse.status !== 200) {
      return [`working (${repoData.private ? 'private' : 'public'})`, 0, 0];
    }

    const contentsData = await contentsResponse.json();

    // 计算文件数量和总大小
    const fileStats = contentsData.reduce((acc, item) => {
      if (item.type === 'file') {
        return {
          count: acc.count + 1,
          size: acc.size + (item.size || 0)
        };
      }
      return acc;
    }, { count: 0, size: 0 });

    return [
      `working (${repoData.private ? 'private' : 'public'})`,
      fileStats.count,
      fileStats.size
    ];

  } catch (error) {
    console.error(`Error checking GitHub repo ${repo}:`, error);
    return [`error: ${error.message}`, 0, 0];
  }
}

// 检查 GitLab 项目的异步函数
async function checkGitLabProject(projectId, pat) {
  const projectUrl = `https://gitlab.com/api/v4/projects/${projectId}`;
  const filesUrl = `https://gitlab.com/api/v4/projects/${projectId}/repository/tree?ref=main&path=${DIR}&recursive=true&per_page=10000`;

  try {
    const [projectResponse, filesResponse] = await Promise.all([
      fetch(projectUrl, {
        headers: { 'PRIVATE-TOKEN': pat }
      }),
      fetch(filesUrl, {
        headers: { 'PRIVATE-TOKEN': pat }
      })
    ]);

    if (projectResponse.status === 200) {
      const projectData = await projectResponse.json();
      let fileCount = 0;

      if (filesResponse.status === 200) {
        const filesData = await filesResponse.json();
        fileCount = filesData.filter(item => item.type === 'blob').length;
      }

      return [
        `working (${projectData.visibility})`,
        projectData.owner.username,
        fileCount
      ];
    } else if (projectResponse.status === 404) {
      return ['not found', 'Unknown', 0];
    } else {
      return ['disconnect', 'Unknown', 0];
    }
  } catch (error) {
    console.error('GitLab project check error:', error);
    return ['disconnect', 'Error', 0];
  }
}