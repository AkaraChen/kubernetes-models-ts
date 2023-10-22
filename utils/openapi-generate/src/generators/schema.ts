import {
  collectRefs,
  Definition,
  generateImports,
  Generator,
  Import,
  Schema,
  transformSchema
} from "@kubernetes-models/generate";
import { trimSuffix } from "@kubernetes-models/string-util";
import { Context } from "../context";
import { getClassName, trimRefPrefix } from "../string";
import { getSchemaPath, isAPIMachineryID, isK8sID } from "../utils";

function replaceRef(schema: Schema): Schema {
  if (typeof schema.$ref === "string") {
    return { ...schema, $ref: trimRefPrefix(schema.$ref) + "#" };
  }

  return schema;
}

function compileSchema(def: Definition): string {
  let schema: Schema = {};

  // Rewrite schemas for some special types
  switch (def.schemaId) {
    case "io.k8s.apimachinery.pkg.util.intstr.IntOrString":
      schema = {
        oneOf: [{ type: "string" }, { type: "integer", format: "int32" }]
      };
      break;

    case "io.k8s.apiextensions-apiserver.pkg.apis.apiextensions.v1beta1.JSON":
    case "io.k8s.apiextensions-apiserver.pkg.apis.apiextensions.v1.JSON":
      schema = {};
      break;

    default:
      schema = transformSchema(def.schema, [replaceRef]);
  }

  return JSON.stringify(schema, null, "  ");
}

export default function ({
  externalAPIMachinery,
  externalKubernetesModels
}: Context): Generator {
  return async (definitions) => {
    return definitions.map((def) => {
      const imports: Import[] = [];
      const refs = collectRefs(def.schema)
        .map(trimRefPrefix)
        .filter((ref) => ref !== def.schemaId);
      let addSchemaContent = "";

      imports.push({
        name: "register",
        path: "@kubernetes-models/validate"
      });

      for (const ref of refs) {
        const name = "addSchema";
        const alias = getClassName(ref);

        if (externalAPIMachinery && isAPIMachineryID(ref)) {
          imports.push({
            name,
            alias,
            path: `@kubernetes-models/apimachinery/${trimSuffix(
              getSchemaPath(ref),
              ".ts"
            )}`
          });
        } else if (externalKubernetesModels && isK8sID(ref)) {
          imports.push({
            name,
            alias,
            path: `kubernetes-models/${trimSuffix(getSchemaPath(ref), ".ts")}`
          });
        } else {
          imports.push({ name, alias, path: `./${getClassName(ref)}` });
        }

        addSchemaContent += `${alias}();\n`;
      }

      return {
        path: getSchemaPath(def.schemaId),
        content: `${generateImports(imports)}

const schema: object = ${compileSchema(def)};

export function addSchema() {
${addSchemaContent}register(${JSON.stringify(def.schemaId)}, schema);
}
`
      };
    });
  };
}
