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

// Azure DevOps Server bilgileri
const configServer = {
  organization: process.env.AZDEVOPS_ORG_SERVER,
  serverUrl: process.env.AZDEVOPS_URL_SERVER,
  personalAccessToken: process.env.AZDEVOPS_PAT_SERVER
};

// Azure DevOps Services bilgileri
const configService = {
  organization: process.env.AZDEVOPS_ORG_SERVICE,
  serverUrl: process.env.AZDEVOPS_URL_SERVICE,
  personalAccessToken: process.env.AZDEVOPS_PAT_SERVICE
};

// API için temel axios instance'ı
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
    throw new Error('Geçersiz ortam seçimi');
  }
};

async function getProjects(environment) {
  const config = getConfig(environment);
  const api = createApiInstance(config);
  const cacheKey = `projects:${environment}`;
  try {
    // Önce Redis'ten veriyi kontrol et
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      console.log('Projeler Redis önbellekten alındı');
      return JSON.parse(cachedData);
    }

    console.log('Projeler API\'dan alınıyor...');
    const response = await api.get('/_apis/projects?api-version=6.0');
    const projects = response.data.value;

    // Veriyi Redis'e kaydet (1 saat süreyle)
    await redis.set(cacheKey, JSON.stringify(projects), 'EX', 3600);
    
    return projects;
  } catch (error) {
    console.error('Projeler alınırken hata oluştu:', error.message);
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
      console.log(`${projectId} projesi için gruplar Redis önbellekten alındı`);
      return JSON.parse(cachedData);
    }

    console.log(`${projectId} projesi için gruplar API'dan alınıyor...`);
    const response = await api.get(`/${projectId}/_api/_identity/ReadScopedApplicationGroupsJson?__v=5`);
    const groups = response.data.identities;

    await redis.set(cacheKey, JSON.stringify(groups), 'EX', 3600);
    
    return groups;
  } catch (error) {
    console.error(`${projectId} projesi için gruplar alınırken hata oluştu:`, error.message);
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
      console.log(`${projectId} projesi için ${teamFoundationId} grubu üyeleri Redis önbellekten alındı`);
      return JSON.parse(cachedData);
    }

    console.log(`${projectId} projesi için ${teamFoundationId} grubu üyeleri API'dan alınıyor...`);
    const response = await api.get(`/${projectId}/_api/_identity/ReadGroupMembers?__v=5&scope=${teamFoundationId}&readMembers=true`);
    const members = response.data.identities;

    await redis.set(cacheKey, JSON.stringify(members), 'EX', 3600);
    
    return members;
  } catch (error) {
    console.error(`${projectId} projesi için ${teamFoundationId} grubu üyeleri alınırken hata oluştu:`, error.message);
    throw error;
  }
}

app.get('/api/projects', async (req, res) => {
  try {
    const environment = req.query.environment;
    console.log('GET /api/projects isteği alındı');
    const projects = await getProjects(environment);
    res.json(projects);
  } catch (error) {
    console.error('Projeler alınırken bir hata oluştu:', error);
    res.status(500).json({ error: 'Projeler alınırken bir hata oluştu.', details: error.message });
  }
});

app.get('/api/data/:projectId', async (req, res) => {
  try {
    const environment = req.query.environment;
    const projectId = req.params.projectId;
    console.log(`GET /api/data/${projectId} isteği alındı`);
    
    const projects = await getProjects(environment);
    const project = projects.find(p => p.id === projectId);
    
    if (!project) {
      return res.status(404).json({ error: 'Proje bulunamadı.' });
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
        console.error(`${project.name} projesi için ${group.FriendlyDisplayName} grubu üyeleri alınırken hata oluştu:`, memberError);
      }
    }

    console.log('Toplam sonuç sayısı:', results.length);
    res.json(results);
  } catch (error) {
    console.error('Veri alınırken bir hata oluştu:', error);
    res.status(500).json({ error: 'Veri alınırken bir hata oluştu.', details: error.message });
  }
});

app.get('/api/all-members', async (req, res) => {
  try {
    const environment = req.query.environment;
    console.log('GET /api/all-members isteği alındı');
    const projects = await getProjects(environment);
    let results = [];

    for (const project of projects) {
      console.log(`İşleniyor: ${project.name}`);
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
            console.error(`${project.name} projesi için ${group.FriendlyDisplayName} grubu üyeleri alınırken hata oluştu:`, memberError);
          }
        }
      } catch (groupError) {
        console.error(`${project.name} projesi için gruplar alınırken hata oluştu:`, groupError);
      }
    }

    console.log('Toplam sonuç sayısı:', results.length);
    res.json(results);
  } catch (error) {
    console.error('Veri alınırken bir hata oluştu:', error);
    res.status(500).json({ error: 'Veri alınırken bir hata oluştu.', details: error.message });
  }
});

app.post('/api/remove-member', async (req, res) => {
  try {
    const { environment, projectId, groupId, memberId } = req.body;
    const config = getConfig(environment);
    const api = createApiInstance(config);

    console.log(`POST /api/remove-member isteği alındı - Project: ${projectId}, Group: ${groupId}, Member: ${memberId}`);

    const response = await api.post(`/${projectId}/_api/_identity/EditMembership?__v=5`, {
      editMembers: "true",
      groupId: groupId,
      removeItemsJson: `[\"${memberId}\"]`
    });

    if (response.status === 200) {
      console.log('Üye başarıyla silindi');

      // Redis'ten ilgili kaydı sil
      const cacheKey = `members:${environment}:${projectId}:${groupId}`;
      await redis.del(cacheKey);

      res.status(200).json({ message: 'Üye başarıyla silindi ve Redis önbelleği temizlendi' });
    } else {
      console.error('Üye silinirken bir hata oluştu:', response.status, response.data);
      res.status(response.status).json({ error: 'Üye silinirken bir hata oluştu' });
    }
  } catch (error) {
    console.error('Üye silinirken bir hata oluştu:', error);
    res.status(500).json({ error: 'Üye silinirken bir hata oluştu', details: error.message });
  }
});


app.listen(port, () => {
  console.log(`Server ${port} portunda çalışıyor`);
});
