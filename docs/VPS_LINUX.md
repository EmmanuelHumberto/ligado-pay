# Gateway no VPS Linux

Continuação até 03/11: papel operacional restrito e configuração Linux preparados; imagem Pay entregue pelo GitHub e carregada, sem ativação. Backup da cópia real recuperado da nova pasta privada do Drive e autenticado, com chave separada. A produção permanece no Windows e nenhuma cobrança foi repetida. [Fluxo de entrega e pendências](../../os-system-web/docs/VPS_ENTREGA_E_BACKUP_2026-11-03.md).

Instalação de teste concluída em 02/11/2026 no Debian 13, usando a imagem da fonte `93e9274b3366af9a00f5579069d8503899bce9c6`. O runtime Windows segue atendendo a produção. [Estado coordenado e evidência](../../os-system-web/docs/VPS_INSTALACAO_SINTETICA.md).

Rodada posterior do mesmo dia: banco real restaurado em cópia separada e gateway iniciado em namespace offline, sem portas publicadas ou rota ao provedor. Token atual conferido, saúde autenticada e leitura de pagamento existente verificadas. Dados financeiros e demais tabelas permaneceram iguais ao backup; somente `request_limits` recebeu as escritas operacionais do limitador. A criação ficou desativada. Contêineres de validação parados ao concluir, volumes preservados, sem troca de DNS. [Resultados e limites da restauração](../../os-system-web/docs/VPS_RESTAURACAO_2026-11-02.md). As descrições de ausência de segredos reais abaixo referem-se apenas à etapa sintética anterior.

A imagem em infra/vps/Dockerfile usa Node fixado por digest, dependências do lockfile e runtime UID 10003 sem root. A composição do consumidor administra o contêiner; o gateway continua exclusivamente uma API, com banco separado, papel restrito e referência externa opaca.

O ambiente de teste usa chave sintética, criação desativada, acesso somente por loopback e saída externa bloqueada no host. Saúde autenticada, negativa de acesso sem token, permissões, reinício e recuperação foram verificados. Os 36 testes unitários passaram. Nenhum segredo real ou pagamento existente foi migrado, nem houve chamada ao provedor financeiro.

O inicializador bootstrap-preview.mjs exige marcador sintético, confirmação explícita e banco vazio. Não é comando de migração de produção e não deve ser executado contra um banco restaurado com pagamentos. As migrações e o runtime não devem usar a mesma credencial administrativa.

Antes do corte: restaurar o banco operacional, provisionar chave real e token do consumidor com privilégios corretos, revisar ciclo das credenciais e retirar o bloqueio sintético de saída em operação coordenada. Configurar proxy autenticado e conciliação sem repetir cobranças já confirmadas. A API não ganha frontend nem acesso ao banco do SystemOS por estar no mesmo servidor.
