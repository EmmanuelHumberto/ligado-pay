# Ligado Pay

API de gateway de pagamentos da Ligado, reutilizável pelo SystemOS, pelo aplicativo por meio de seu backend, pela futura loja virtual e por outras aplicações autorizadas.

## Escopo

O Ligado Pay recebe solicitações de pagamento dos servidores das aplicações integradoras, comunica-se com provedores financeiros e expõe o resultado financeiro por API e eventos autenticados. O projeto começa somente como API; não inclui portal, loja, aplicativo ou painel administrativo.

São responsabilidades do gateway:

- Criar, consultar, cancelar e solicitar estorno de cobranças, conforme as capacidades e contratos do provedor.
- Controlar cobranças, tentativas e estados financeiros, incluindo resultados incertos, estornos parciais e contestações quando suportados.
- Integrar provedores por adaptadores, com credenciais protegidas e segregadas por conta recebedora e ambiente.
- Autenticar aplicações integradoras e limitar suas permissões sobre contas recebedoras, operações e cobranças.
- Verificar notificações dos provedores, impedir processamento duplicado e consultar o provedor para confirmar dados e estados financeiros.
- Entregar eventos autenticados às aplicações, com persistência, tentativas de reenvio e consulta de recuperação.
- Executar conciliação financeira, manter rastreabilidade das operações e oferecer observabilidade necessária ao pagamento.

## Limites de responsabilidade

OS, orçamento, aprovação de serviços, garantia, estoque, catálogo, frete, pedidos comerciais, CRM e cadastro geral de clientes pertencem às aplicações integradoras. O Ligado Pay não acessa suas tabelas nem decide suas regras de negócio.

O servidor da aplicação de origem autoriza a cobrança e fornece valor, moeda e uma referência externa opaca. O gateway valida o contrato, as permissões, os limites e a consistência financeira. As aplicações decidem o efeito de um pagamento em seus próprios processos.

Dados do pagador são limitados aos necessários à operação e às exigências do provedor; não constituem um cadastro comercial de clientes. Conta recebedora, aplicação integradora, cobrança e tentativa de pagamento são conceitos distintos.

Não fazem parte do escopo: faturamento de planos SaaS, gestão de assinantes de software, carteira com saldo sacável, custódia ou repasse próprio de recursos, concessão de crédito ou serviços bancários. A liquidação ocorre pelo provedor contratado diretamente para a conta recebedora habilitada. Novas modalidades financeiras exigem decisão explícita de escopo e avaliação contratual e regulatória.

## Integração e segurança

- Contrato de API versionado, independente do modelo de dados de cada consumidor.
- Chaves de idempotência segregadas por aplicação, conta recebedora e operação.
- Valores em centavos inteiros, com moeda explícita; nenhum valor autorizado apenas pelo navegador ou aplicativo.
- Isolamento de dados, eventos e credenciais entre aplicações, recebedores e ambientes.
- Nenhum armazenamento de CVV ou credenciais bancárias do pagador. Preferência por tokenização ou checkout do provedor.
- Redirecionamento do navegador nunca confirma pagamento. O provedor é consultado e os dados financeiros são validados.
- Auditoria e logs sem segredos, com retenção definida e dados pessoais minimizados.

## Diretriz para a primeira entrega

Uso privado da Ligado na aba de pagamentos da aprovação de serviços, no portal web e no app. Ambos usam o backend do SystemOS; não recebem credenciais do gateway. A aprovação e o cálculo do orçamento permanecem no SystemOS. A API do Ligado Pay recebe uma solicitação autorizada e uma referência opaca, sem consultar a OS.

Pix é um meio de pagamento do arranjo do Banco Central. A cobrança integrada será emitida pela API de uma instituição participante contratada; não existe neste projeto um conector de cobrança direta ao Banco Central. A interface deve mostrar Pix e identificar a instituição recebedora de forma clara. Outros provedores só aparecem após habilitação e homologação das capacidades necessárias.

Requisitos e sequência de entrega: [arquitetura e segurança](docs/arquitetura-seguranca-inicial.md). Critérios e pesquisa preliminar: [provedores](docs/provedores.md).

## Estado de implementação

Para continuar o trabalho, leia primeiro as [anotações de retomada](docs/retomada.md), incluindo o Pix real já confirmado e as restrições para não repetir a operação.

Base local executável em TypeScript/Fastify com PostgreSQL próprio, autenticação de serviço, autorização por aplicação/recebedor, intenção durável, idempotência e eventos/outbox transacionais. O padrão é simulado. Há composição local selecionável para InfinitePay, com segredo protegido, link persistido e confirmação por consulta; criação real fica desligada por padrão. A conta é identificada como produção, sem inventar sandbox. Implantação em produção ainda bloqueada. Nenhum pagamento foi migrado e nenhum serviço foi publicado. SystemOS, portal e app permanecem independentes desta preparação.

- [Arquitetura executável e controles presentes](docs/arquitetura.md)
- [Modelo de ameaças e pendências](docs/modelo-ameacas.md)
- [Execução e testes locais](docs/desenvolvimento-local.md)
- [InfinitePay: adaptador em validação, limites e homologação pendente](docs/infinitepay.md)
