# Limite do projeto

O usuário determinou que o Ligado Pay seja unicamente uma API de gateway de pagamentos. Preserve esse limite em código, contratos, dependências e documentação.

- Leia o README.md antes de implementar. Inclua somente responsabilidades inerentes ao processamento e à integração de pagamentos.
- Não introduza regras de OS, orçamento, manutenção, estoque, frete, catálogo, CRM ou pedidos comerciais. Referencie a operação de origem por identificador externo opaco.
- Não compartilhe tabelas nem consulte diretamente os bancos das aplicações consumidoras.
- Não crie frontend, aplicativo, portal, painel ou faturamento de SaaS sem nova solicitação explícita.
- Diferencie aplicação integradora e conta recebedora. Autorização e isolamento devem abranger ambas, além do ambiente.
- Preserve idempotência, rastreabilidade, conciliação e recuperação de falhas. Timeout não prova que uma cobrança falhou; retorno do navegador não prova liquidação.
- Não registre tokens, segredos, dados de cartão ou dados pessoais desnecessários. Não armazene CVV.
- Não migre pagamentos existentes, altere webhooks de produção, publique serviços ou envie alterações ao remoto apenas por preparar o diretório local.
- O primeiro uso é privado, na aprovação de serviços do SystemOS, portal e app. Não abrir cadastro público de recebedores. Ler docs/arquitetura-seguranca-inicial.md e docs/provedores.md antes de implementar.
- Não implementar um falso conector Pix direto com o Banco Central. Cobranças usam API oficial de PSP contratado. Documentação pública não equivale a homologação ou elegibilidade contratual.
