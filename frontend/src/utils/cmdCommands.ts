export const getCmdForDns = (domain: string) =>
  `nslookup ${domain}`

export const getCmdForDnsStep = (domain: string, serverIp: string) =>
  `nslookup ${domain} ${serverIp}`

export const getCmdForTracert = (domain: string) =>
  `tracert ${domain}`

export const getCmdForTcp = (host: string, port = 443) =>
  `curl.exe -v --connect-timeout 10 http://${host}:${port}`

export const getCmdForTls = (domain: string) =>
  `curl -v https://${domain}`

export const getCmdForHttp = (domain: string) =>
  `curl https://${domain}`
