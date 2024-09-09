const express = require('express');
const axios = require('axios');
const cors = require('cors');
const Redis = require('ioredis');

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: 6379,
});

// Azure DevOps Server 
const configServer = {
  organization: process.env.AZDEVOPS_ORG_SERVER,
  serverUrl: process.env.AZDEVOPS_URL_SERVER,
  personalAccessToken: process.env.AZDEVOPS_PAT_SERVER
};

// Azure DevOps Services
const configService = {
  organization: process.env.AZDEVOPS_ORG_SERVICE,
  serverUrl: process.env.AZDEVOPS_URL_SERVICE,
  personalAccessToken: process.env.AZDEVOPS_PAT_SERVICE
};


const createApiInstance = (config) => axios.create({
  baseURL: `${config.serverUrl}/${config.organization}`,
  headers: {
    'Authorization': `Basic ${Buffer.from(`:${config.personalAccessToken}`).toString('base64')}`,
    'Content-Type': 'application/json',
  },
});

const getConfig = (environment) => {
  if (environment === 'server') {
    return configServer;
  } else if (environment === 'services') {
    return configService;
  } else {
    throw new Error('Invalid environment selection');
  }
};

async function getProjects(environment) {
  const config = getConfig(environment);
  const api = createApiInstance(config);
  const cacheKey = `projects:${environment}`;
  try {
    // Check data from Redis first
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      console.log('Projects retrieved from Redis cache');
      return JSON.parse(cachedData);
    }

    console.log('Fetching projects from API...');
    const response = await api.get('/_apis/projects?api-version=6.0');
    const projects = response.data.value;

    // Save data to Redis (for 1 hour)
    await redis.set(cacheKey, JSON.stringify(projects), 'EX', 3600);
    
    return projects;
  } catch (error) {
    console.error('Error occurred while fetching projects:', error.message);
    throw error;
  }
}

async function getProjectGroups(environment, projectId) {
  const config = getConfig(environment);
  const api = createApiInstance(config);
  const cacheKey = `groups:${environment}:${projectId}`;
  try {
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      console.log(`Groups for project ${projectId} retrieved from Redis cache`);
      return JSON.parse(cachedData);
    }

    console.log(`Fetching groups for project ${projectId} from API...`);
    const response = await api.get(`/${projectId}/_api/_identity/ReadScopedApplicationGroupsJson?__v=5`);
    const groups = response.data.identities;

    await redis.set(cacheKey, JSON.stringify(groups), 'EX', 3600);
    
    return groups;
  } catch (error) {
    console.error(`Error occurred while fetching groups for project ${projectId}:`, error.message);
    throw error;
  }
}

async function getGroupMembers(environment, projectId, teamFoundationId) {
  const config = getConfig(environment);
  const api = createApiInstance(config);
  const cacheKey = `members:${environment}:${projectId}:${teamFoundationId}`;
  try {
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      console.log(`Members of group ${teamFoundationId} for project ${projectId} retrieved from Redis cache`);
      return JSON.parse(cachedData);
    }

    console.log(`Fetching members of group ${teamFoundationId} for project ${projectId} from API...`);
    const response = await api.get(`/${projectId}/_api/_identity/ReadGroupMembers?__v=5&scope=${teamFoundationId}&readMembers=true`);
    const members = response.data.identities;

    await redis.set(cacheKey, JSON.stringify(members), 'EX', 3600);
    
    return members;
  } catch (error) {
    console.error(`Error occurred while fetching members of group ${teamFoundationId} for project ${projectId}:`, error.message);
    throw error;
  }
}

app.get('/api/projects', async (req, res) => {
  try {
    const environment = req.query.environment;
    console.log('GET /api/projects request received');
    const projects = await getProjects(environment);
    res.json(projects);
  } catch (error) {
    console.error('An error occurred while fetching projects:', error);
    res.status(500).json({ error: 'An error occurred while fetching projects.', details: error.message });
  }
});

app.get('/api/data/:projectId', async (req, res) => {
  try {
    const environment = req.query.environment;
    const projectId = req.params.projectId;
    console.log(`GET /api/data/${projectId} request received`);
    
    const projects = await getProjects(environment);
    const project = projects.find(p => p.id === projectId);
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found.' });
    }

    let results = [];
    const groups = await getProjectGroups(environment, projectId);

    for (const group of groups) {
      try {
        const members = await getGroupMembers(environment, projectId, group.TeamFoundationId);

        for (const member of members) {
          results.push({
            Project: project.name,
            ProjectId: project.id,
            Group: group.FriendlyDisplayName,
            GroupId: group.TeamFoundationId,
            Member: member.DisplayName,
            MemberId: member.TeamFoundationId
          });
        }
      } catch (memberError) {
        console.error(`Error occurred while fetching members of group ${group.FriendlyDisplayName} for project ${project.name}:`, memberError);
      }
    }

    console.log('Total number of results:', results.length);
    res.json(results);
  } catch (error) {
    console.error('An error occurred while fetching data:', error);
    res.status(500).json({ error: 'An error occurred while fetching data.', details: error.message });
  }
});

app.get('/api/all-members', async (req, res) => {
  try {
    const environment = req.query.environment;
    console.log('GET /api/all-members request received');
    const projects = await getProjects(environment);
    let results = [];

    for (const project of projects) {
      console.log(`Processing: ${project.name}`);
      try {
        const groups = await getProjectGroups(environment, project.id);

        for (const group of groups) {
          try {
            const members = await getGroupMembers(environment, project.id, group.TeamFoundationId);

            for (const member of members) {
              results.push({
                Project: project.name,
                ProjectId: project.id,
                Group: group.FriendlyDisplayName,
                GroupId: group.TeamFoundationId,
                Member: member.DisplayName,
                MemberId: member.TeamFoundationId
              });
            }
          } catch (memberError) {
            console.error(`Error occurred while fetching members of group ${group.FriendlyDisplayName} for project ${project.name}:`, memberError);
          }
        }
      } catch (groupError) {
        console.error(`Error occurred while fetching groups for project ${project.name}:`, groupError);
      }
    }

    console.log('Total number of results:', results.length);
    res.json(results);
  } catch (error) {
    console.error('An error occurred while fetching data:', error);
    res.status(500).json({ error: 'An error occurred while fetching data.', details: error.message });
  }
});

app.post('/api/remove-member', async (req, res) => {
  try {
    const { environment, projectId, groupId, memberId } = req.body;
    const config = getConfig(environment);
    const api = createApiInstance(config);

    console.log(`POST /api/remove-member request received - Project: ${projectId}, Group: ${groupId}, Member: ${memberId}`);

    const response = await api.post(`/${projectId}/_api/_identity/EditMembership?__v=5`, {
      editMembers: "true",
      groupId: groupId,
      removeItemsJson: `["${memberId}"]`
    });

    if (response.status === 200) {
      console.log('Member successfully removed');

      // Delete the relevant record from Redis
      const cacheKey = `members:${environment}:${projectId}:${groupId}`;
      await redis.del(cacheKey);

      res.status(200).json({ message: 'Member successfully removed and Redis cache cleared' });
    } else {
      console.error('An error occurred while removing member:', response.status, response.data);
      res.status(response.status).json({ error: 'An error occurred while removing member' });
    }
  } catch (error) {
    console.error('An error occurred while removing member:', error);
    res.status(500).json({ error: 'An error occurred while removing member', details: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
