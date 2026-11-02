# Gateway no VPS Linux

Instalação de teste concluída em 02/11/2026 no Debian 13, usando a imagem da fonte `93e9274b3366af9a00f5579069d8503899bce9c6`. O runtime Windows segue atendendo a produção. [Estado coordenado e evidência](../../os-system-web/docs/VPS_INSTALACAO_SINTETICA.md).

A imagem em infra/vps/Dockerfile usa Node fixado por digest, dependências do lockfile e runtime UID 10003 sem root. A composição do consumidor administra o contêiner; o gateway continua exclusivamente uma API, com banco separado, papel restrito e referência externa opaca.

O ambiente de teste usa chave sintética, criação desativada, acesso somente por loopback e saída externa bloqueada no host. Saúde autenticada, negativa de acesso sem token, permissões, reinício e recuperação foram verificados. Os 36 testes unitários passaram. Nenhum segredo real ou pagamento existente foi migrado, nem houve chamada ao provedor financeiro.

O inicializador bootstrap-preview.mjs exige marcador sintético, confirmação explícita e banco vazio. Não é comando de migração de produção e não deve ser executado contra um banco restaurado com pagamentos. As migrações e o runtime não devem usar a mesma credencial administrativa.

Antes do corte: restaurar o banco operacional, provisionar chave real e token do consumidor com privilégios corretos, revisar ciclo das credenciais e retirar o bloqueio sintético de saída em operação coordenada. Configurar proxy autenticado e conciliação sem repetir cobranças já confirmadas. A API não ganha frontend nem acesso ao banco do SystemOS por estar no mesmo servidor.
