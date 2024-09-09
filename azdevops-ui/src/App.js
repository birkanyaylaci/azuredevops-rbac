import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { Table, Select, Space, Typography, Spin, Input, Button, Popconfirm, message, Modal, Row, Col, Card, Tooltip, Tag } from 'antd';
import { SearchOutlined, DownloadOutlined, DeleteOutlined, InfoCircleOutlined } from '@ant-design/icons';
import * as XLSX from 'xlsx';
import './App.css';

const { Option } = Select;
const { Title } = Typography;

function App() {
  const [data, setData] = useState([]);
  const [filteredData, setFilteredData] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedEnvironment, setSelectedEnvironment] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [selectedRows, setSelectedRows] = useState([]);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [uniqueMembersCount, setUniqueMembersCount] = useState(0);
  const [projectsCount, setProjectsCount] = useState(0);
  const [isUniqueMembersModalVisible, setIsUniqueMembersModalVisible] = useState(false);

  const uniqueMembers = useMemo(() => Array.from(new Set(data.map(item => item.Member).filter(member => !member.startsWith('[')))), [data]);

  const apiBaseUrl = 'http://localhost:3001';

  const fetchProjects = useCallback(async () => {
    if (!selectedEnvironment) return;
    try {
      setLoading(true);
      const response = await axios.get(`${apiBaseUrl}/api/projects?environment=${selectedEnvironment}`);
      setProjects(response.data);
      setProjectsCount(response.data.length);
    } catch (error) {
      console.error('Error occurred while fetching projects:', error);
      message.error('An error occurred while fetching projects. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [selectedEnvironment]);

  const fetchData = useCallback(async (projectId = null) => {
    if (!selectedEnvironment) return;
    setLoading(true);
    try {
      let response;
      if (projectId) {
        response = await axios.get(`${apiBaseUrl}/api/data/${projectId}?environment=${selectedEnvironment}`);
      } else {
        response = await axios.get(`${apiBaseUrl}/api/all-members?environment=${selectedEnvironment}`);
      }
      setData(response.data);
      setFilteredData(response.data);

      const uniqueMembers = new Set(response.data.map(item => item.Member).filter(member => !member.startsWith('[')));
      setUniqueMembersCount(uniqueMembers.size);

    } catch (error) {
      console.error('Error occurred while fetching data:', error);
      message.error('An error occurred while fetching data. Please try again.');
      setData([]);
      setFilteredData([]);
    } finally {
      setLoading(false);
    }
  }, [selectedEnvironment]);

  const filterData = useCallback(() => {
    let filtered = data;
    if (selectedProject) {
      filtered = filtered.filter(item => item.Project === projects.find(p => p.id === selectedProject)?.name);
    }
    if (memberSearch) {
      filtered = filtered.filter(item =>
        item.Member.toLowerCase().includes(memberSearch.toLowerCase())
      );
    }
    setFilteredData(filtered);
  }, [data, memberSearch, selectedProject, projects]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (data.length > 0) {
      filterData();
    }
  }, [data, memberSearch, selectedProject, filterData]);

  const handleEnvironmentChange = (value) => {
    setSelectedEnvironment(value);
    setSelectedProject(null);
    setMemberSearch('');
    setProjects([]);
    setData([]);
    setFilteredData([]);
    setSelectedRowKeys([]);
    setSelectedRows([]);
  };

  const handleProjectChange = (value) => {
    setSelectedProject(value);
    fetchData(value);
  };

  const handleMemberSearch = (e) => {
    setMemberSearch(e.target.value);
  };

  const handleSearch = () => {
    fetchData(selectedProject);
  };

  const handleTableChange = (pagination) => {
    setPagination(pagination);
  };

  const downloadExcel = () => {
    const filteredColumnsData = filteredData.map(({ Project, Group, Member }) => ({
      Project,
      Group,
      Member,
    }));

    const worksheet = XLSX.utils.json_to_sheet(filteredColumnsData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
    XLSX.writeFile(workbook, "azureDevopsUserList.xlsx");
    message.success('Excel file downloaded successfully.');
  };

  const removeMembers = async () => {
    if (!selectedEnvironment) {
      message.error('Please select an environment first.');
      return;
    }

    try {
      setLoading(true);
      const promises = selectedRows.map(row => 
        axios.post('${apiBaseUrl}/api/remove-member', {
          environment: selectedEnvironment,
          projectId: row.ProjectId,
          groupId: row.GroupId,
          memberId: row.MemberId
        })
      );

      await Promise.all(promises);
      setSelectedRowKeys([]);
      setSelectedRows([]);
      message.success('Selected members were successfully removed from the group.');
      fetchData(selectedProject);
    } catch (error) {
      console.error('An error occurred while removing members from the group:', error);
      message.error('An error occurred while removing members from the group.');
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    {
      title: 'Project',
      dataIndex: 'Project',
      key: 'Project',
      sorter: (a, b) => a.Project.localeCompare(b.Project),
    },
    {
      title: 'Group',
      dataIndex: 'Group',
      key: 'Group',
      sorter: (a, b) => a.Group.localeCompare(b.Group),
    },
    {
      title: 'Member',
      dataIndex: 'Member',
      key: 'Member',
      sorter: (a, b) => a.Member.localeCompare(b.Member),
    },
  ];

  const rowSelection = {
    selectedRowKeys,
    onChange: (newSelectedRowKeys, newSelectedRows) => {
      setSelectedRowKeys(newSelectedRowKeys);
      setSelectedRows(newSelectedRows);
    },
    preserveSelectedRowKeys: true,
  };

  const showModal = () => {
    setIsModalVisible(true);
  };

  const handleOk = () => {
    setIsModalVisible(false);
  };

  const handleCancel = () => {
    setIsModalVisible(false);
  };

  const showUniqueMembersModal = () => {
    setIsUniqueMembersModalVisible(true);
  };

  return (
    <div className="container">
      <Row gutter={[16, 16]}>
        <Col span={24}>
          <Title level={2} className="title">Azure DevOps Permission Control</Title>
        </Col>
        <Col span={24}>
          <Card>
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Row gutter={[16, 16]}>
                <Col xs={24} sm={12} md={6}>
                  <Tooltip title="Select the Azure DevOps environment you want to work with">
                    <Select
                      className="select"
                      placeholder="Select environment"
                      onChange={handleEnvironmentChange}
                      value={selectedEnvironment}
                      allowClear
                      style={{ width: '100%' }}
                    >
                      <Option value="server">Azure DevOps Server</Option>
                      <Option value="services">Azure DevOps Services</Option>
                    </Select>
                  </Tooltip>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Tooltip title="Select the project you want to examine">
                    <Select
                      className="select"
                      placeholder="Select project"
                      onChange={handleProjectChange}
                      value={selectedProject}
                      allowClear
                      disabled={!selectedEnvironment}
                      style={{ width: '100%' }}
                    >
                      {projects.map(project => (
                        <Option key={project.id} value={project.id}>{project.name}</Option>
                      ))}
                    </Select>
                  </Tooltip>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Tooltip title="Search by member name">
                    <Input
                      className="input"
                      placeholder="Search Member"
                      prefix={<SearchOutlined />}
                      value={memberSearch}
                      onChange={handleMemberSearch}
                      disabled={!selectedEnvironment}
                      style={{ width: '100%' }}
                    />
                  </Tooltip>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Space>
                    <Tooltip title="Search according to selected criteria">
                      <Button type="primary" onClick={handleSearch} disabled={!selectedEnvironment} icon={<SearchOutlined />}>
                        Search
                      </Button>
                    </Tooltip>
                    <Tooltip title="Download results as an Excel file">
                      <Button onClick={downloadExcel} disabled={!selectedEnvironment} icon={<DownloadOutlined />}>
                        Download Excel
                      </Button>
                    </Tooltip>
                  </Space>
                </Col>                
                <Col xs={24} sm={12} md={6}>
                  <Tooltip title="Click for detailed information">
                    <Tag color="blue" onClick={showUniqueMembersModal}>Number of People: {uniqueMembersCount}</Tag>                    
                  </Tooltip>
                    <Tag color="green">Total Number of Projects: {projectsCount}</Tag>
                </Col>
              </Row>

            </Space>

          </Card>
        </Col>
        <Col span={24}>
          {loading ? (
            <div style={{ textAlign: 'center', margin: '20px 0' }}>
              <Spin size="large" />
            </div>
          ) : (
            <>
              {selectedRows.length > 0 && (
                <div className="actions-container">
                  <Space>
                    <Popconfirm
                      title="Are you sure you want to remove the selected members from the group?"
                      onConfirm={removeMembers}
                      okText="Yes"
                      cancelText="No"
                    >
                    <Tooltip title="Remove selected members from the group">
                    <Button type="danger" icon={<DeleteOutlined />} style={{ color: 'red' }}>
                      Delete Selected Members ({selectedRows.length})
                    </Button>
                    </Tooltip>
                    </Popconfirm>
                    <Tooltip title="View selected members">
                      <Button onClick={showModal} icon={<InfoCircleOutlined />}>
                        Show Selected Members
                      </Button>
                    </Tooltip>
                  </Space>
                </div>
              )}
              <Table
                className="table"
                columns={columns}
                dataSource={filteredData}
                rowKey={(record) => `${record.Project}-${record.Group}-${record.Member}`}
                pagination={pagination}
                onChange={handleTableChange}
                rowSelection={rowSelection}
              />

            </>
          )}
        </Col>
      </Row>
      <Modal title="Selected People" visible={isModalVisible} onOk={handleOk} onCancel={handleCancel}>
        <ul>
          {selectedRows.map(row => (
            <li key={`${row.Project}-${row.Group}-${row.Member}`}>
              {row.Project} - {row.Group} - {row.Member}
            </li>
          ))}
        </ul>
      </Modal>
      <Modal
        title="Members"
        visible={isUniqueMembersModalVisible}
        onOk={() => setIsUniqueMembersModalVisible(false)}
        onCancel={() => setIsUniqueMembersModalVisible(false)}
      >
        <ul>
          {uniqueMembers.map((member, index) => (
            <li key={index}>{member}</li>
          ))}
        </ul>
      </Modal>
    </div>
  );
  
}

export default App;