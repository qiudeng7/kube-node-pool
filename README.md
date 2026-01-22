# Kube Node Pool

在腾讯云上维护竞价实例节点池并建立集群。

功能如下

![](node-pool.png)

## 包管理

使用pnpm，如果有需要构建的包，把它添加到 package.json 中的 `pnpm.onlyBuiltDependencies` 字段

## 数据库

1. 数据库使用 drizzle + SQLite
2. user 用户表，每个用户需要明文存储账号密码，以及腾讯云的secretID和secretKey；
3. cluster 集群表，字段包括 名称、备注、期望节点数、实际节点数
4. node 节点表，字段包括 名称、ip、所属集群、身份(控制面或工作节点)
5. polling 轮询记录表，字段包括：查询时间、查询的节点、查询结果

## cloudVendor 云服务商

云服务商的模块结构如下：
- cloudVendor               云服务商模块
  - tencent/                腾讯云
    - signedClient/         签名客户端，用于发起请求
    - index                 腾讯云API实现
  - interface               云服务商接口
  - index                   导出接口和腾讯云实现

接口内容主要包括：
1. 配置性的：设置secrets
2. 功能性的：创建服务器、查询服务器状态、查询可用的template 等。

## kube 集群

接口如下

1. 获取一个脚本，对server进行setup，安装kubeadm和kubectl之类；
2. 初始化节点，把节点初始化为 control-plane；
3. 加入集群，让节点加入集群；
4. 检查k8s集群节点状态，相当于执行kubectl get nodes；
5. 获取集群kubeconfig