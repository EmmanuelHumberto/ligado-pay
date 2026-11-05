# Identidade compartilhada Ligado

Decisão de arquitetura registrada em **04/11/2026**, a pedido do titular.

**Estado: direção aprovada para implementação futura.** Este documento não publica um serviço de identidade, não altera configurações Google e não migra contas, sessões ou permissões. Os logins existentes continuam vigentes. Nome operacional, domínio, fornecedor de identidade, endpoints e credenciais ainda precisam ser definidos e validados; não existe nova API de autenticação entregue por esta documentação.

Evolução local de 04/11/2026: o LIGADO STORE recebeu um cliente OIDC, conta progressiva e carrinho, testados com provedor sintético. Isso não implementa o serviço central nem comprova login Google/SSO real. SystemOS, Android e Pay mantêm seus runtimes de autenticação. Detalhes da entrega ficam em docs/22_CONTA_CATALOGO_CARRINHO.md no repositório da loja.

## Objetivo e divisão

Reutilizar a identidade de uma pessoa no SystemOS, no aplicativo Android e no LIGADO STORE, com entrada Google e possibilidade de SSO por OpenID Connect. Identidade comum não concede acesso automático aos dados ou funções de outra aplicação.

| Componente | Responsabilidade |
|---|---|
| Identidade Ligado | Autenticação, vínculo com provedor externo, identificador estável da pessoa e contratos de sessão/revogação |
| SystemOS | Cadastro e vínculo com organização, autorização interna, assistência, clientes e OS |
| Android | Cliente nativo da identidade e das APIs autorizadas; não hospeda o serviço de login |
| LIGADO STORE | Cadastro comercial progressivo, compradores, endereços, carrinho, pedidos e permissões da loja |
| Ligado Pay | Autenticação entre servidores, aplicações integradoras, ambientes e contas recebedoras; permanece exclusivamente gateway |

A identidade é uma responsabilidade separada de pagamentos e dos domínios comerciais. Não criar um servidor OAuth/OIDC artesanal apenas para eliminar duplicação: escolher uma implementação/provedor mantido e avaliar operação, recuperação e atualização antes de introduzir o serviço central. Compartilhar um pacote de validações não equivale a entregar SSO.

## Limites de confiança

- Cada aplicação terá registro/cliente próprio e retornos explicitamente permitidos. Android é cliente público, sem segredo OAuth no APK. Os tipos e identificadores dos clientes precisam ser definidos conforme o provedor escolhido.
- Cada API valida emissor, assinatura, validade, audiência e escopos aplicáveis. Um token emitido para uma aplicação não autoriza outra. ID token identifica o login e não é um bearer genérico para APIs.
- Sessões e cookies próprios por aplicação; não copiar cookies entre portais/app nem usar cookie abrangente para todos os subdomínios. Web com cookies HttpOnly, Secure em produção e proteção CSRF/Origin. SSO ocorre pelo protocolo e pela sessão do provedor.
- Fluxo de autorização com code, PKCE, state, nonce e prevenção de replay conforme o cliente e o protocolo; SDK nativo suportado ou navegador do sistema no Android, nunca formulário Google em WebView controlada.
- Manter separadas as identidades/permissões de cliente e equipe. Acesso administrativo exige concessão explícita, escopo da organização e MFA conforme a política vigente; Google verificado não torna ninguém administrador.
- Usar identificador interno estável e mapear o par emissor/subject do provedor. Não unir históricos ou conceder titularidade por coincidência de e-mail, CPF/CNPJ, nome ou telefone. Migração de vínculos existentes exige prova verificável e auditoria.
- Bases comerciais continuam independentes, sem leitura direta do banco de identidade. Compartilhar somente atributos mínimos por contrato; dados fiscais, endereços, documentos e consentimentos específicos continuam sob responsabilidade da aplicação.
- Nenhuma senha, token, chave, código de autorização ou documento pessoal deve constar em logs, exemplos ou Git. Segredos de aplicação e chaves de assinatura são distintos e rotacionáveis.

## Sessões, privacidade e disponibilidade

Definir antes do rollout: validade absoluta/ociosidade, renovação e rotação, revogação por dispositivo/aplicação, troca de conta e encerramento global. Sair de uma aplicação não deve prometer sair de todas sem mecanismo implementado. Desativar o espaço do cliente no portal não exclui automaticamente a identidade global ou os registros comerciais preservados por regra própria.

Aceites são versionados por finalidade/aplicação. Um aceite no SystemOS não substitui automaticamente termos de compra ou outras finalidades da loja; não repetir aceite vigente a cada login.

Documentar o impacto da indisponibilidade do serviço central. Novos logins e renovações falham de forma segura; sessões já emitidas seguem sua política de validade e revogação, sem ampliar prazos nem contornar validações. APIs não devem consultar o serviço central em toda leitura sem necessidade. Planejar backup, restauração, monitoramento e recuperação antes da ativação.

## Contratos a elaborar

1. Provedor e descoberta OIDC, registros de clientes, emissor/audiências, JWKS/rotação e retornos permitidos por ambiente.
2. Identificador de identidade, atributos mínimos e vínculo explícito com contas locais e organizações; sem perfil comercial global obrigatório.
3. Início/retorno do login, criação/renovação de sessão, logout, revogação e erros seguros para web e Android.
4. Eventos autenticados de suspensão/revogação quando necessários, com idempotência, recuperação e auditoria sem dados excessivos.
5. Autenticação de servidores do Pay preservada em contrato distinto. SSO não autoriza browser/app a chamar o gateway com token de usuário.

Estes itens são requisitos, não endpoints disponíveis. Manter contratos executáveis e matrizes de implementação fiéis ao runtime atual até a entrega e validação de cada etapa.

## Migração e critérios de aceite

1. Inventariar logins, clientes Google, sessões e vínculos existentes sem extrair segredos para documentação.
2. Definir o provedor, os contratos e o modelo de ameaças; preservar autorização por organização e titularidade em cada sistema.
3. Implementar e testar em ambiente isolado; integrar a loja sem alterar o login de produção do SystemOS por efeito colateral.
4. Migrar SystemOS e Android de forma coordenada e gradual, com compatibilidade temporária delimitada, vínculo verificado, rollback e reconciliação de contas. Não desativar o login anterior antes da validação do substituto.
5. Validar issuer/audience incorretos, replay, nonce/state/PKCE, expiração, cookies/CSRF, troca de conta, privilégios, isolamento entre organizações, revogação, refresh concorrente e indisponibilidade. Para SDK nativo, aplicar os controles correspondentes ao fluxo suportado.
6. Homologar login real web/Android, SSO entre aplicações, ausência de acesso cruzado e logout/revogação. Distinguir código testado, publicação e APK instalado. Não realizar cobranças para testar identidade.

## Referências e manutenção

- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).
- [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html).
- [OAuth para aplicativos nativos — RFC 8252](https://www.rfc-editor.org/rfc/rfc8252).

Este núcleo de decisão está registrado com o mesmo conteúdo nos quatro repositórios, em `docs/IDENTIDADE_COMPARTILHADA_2026-11-04.md`. Alterações transversais devem atualizar as quatro cópias; o impacto local abaixo complementa a decisão, sem mudar seus limites.

## Impacto neste repositório

Não implementar login Google, cadastro de pessoas, sessões de cliente, portal ou servidor de identidade neste gateway. Preservar as credenciais e a autorização atuais entre serviços por aplicação, ambiente e conta recebedora. A autenticação humana ocorre nas aplicações consumidoras; a documentação desta decisão não troca as credenciais do Pay nem altera cobranças, webhooks ou conciliação.

## Decisão do titular — Keycloak, começando pela loja

Em 04/11/2026 o titular escolheu Keycloak compartilhado, isolado no VPS, iniciando pelo LIGADO STORE. A infraestrutura e o banco de identidade são separados dos bancos comerciais e do gateway. Cliente OIDC distinto para compradores e equipe da loja; SystemOS/Android serão integrados posteriormente, sem alterar seus logins atuais nesta etapa. Ligado Pay continua fora do login de pessoas.

Estado em **05/11/2026**: `login.ligadotattoo.com.br`, realm `ligado`, está publicado com HTTPS e broker Google conectado. O titular cadastrou o autenticador, confirmado por metadados no servidor. Admin, realm master e endpoints operacionais continuam bloqueados pelo proxy público. A loja mantém autorização explícita por issuer/subject; e-mail, comprador e senha externa da homologação não conferem administração.

Cada aplicação terá cliente OIDC próprio no Keycloak. Os clientes Store permanecem desativados: retorno administrativo implementado/testado localmente, mas token forte real, publicação, migrações 006/007 e vínculo de autorização ainda pendentes. Cadastro de OTP não comprova que a Store validou um login administrativo real. Nenhuma conta ou sessão vigente de SystemOS/Android/Pay foi migrada ou alterada.

Backup cifrado da identidade e restauração PostgreSQL foram verificados; boot completo da identidade contra base restaurada e recuperação humana continuam pendentes. A cópia cifrada local foi atualizada sem sincronizar com Drive. Estado executado, limites e evidências: `ligado-loja/docs/31_IDENTIDADE_KEYCLOAK.md`.
