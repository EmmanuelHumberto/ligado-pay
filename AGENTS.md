# Limite do projeto

O usuário determinou que o Ligado Pay seja unicamente uma API de gateway de pagamentos. Preserve esse limite em código, contratos, dependências e documentação.

- Ao retomar, leia `docs/retomada.md`: o teste real de R$ 1,00 já foi pago e confirmado; não repetir a operação nem remover o marcador de tentativa para recriá-la.

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
- Prioridade atual: InfinitePay. Ler docs/infinitepay.md. O usuário criou a chave e informou que não existe seleção de sandbox na conta; não insistir que obtenha sandbox ou resposta do suporte para desenvolver. Prosseguir com a documentação disponível, testes locais e limitações explícitas. Antes de qualquer operação real, apresentar a operação concreta e seus efeitos para autorização. A configuração local selecionável não comprova homologação real nem autorização de cobrança; manter criação real desligada por padrão.
