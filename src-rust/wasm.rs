use async_trait::async_trait;
use js_sys::{Function, Promise, Reflect, Uint8Array};
use serde::Serialize;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

struct JsHost(JsValue);

impl JsHost {
    async fn call(&self, name: &str, args: &[JsValue]) -> Result<JsValue, String> {
        let function = Reflect::get(&self.0, &JsValue::from_str(name))
            .map_err(js_error)?
            .dyn_into::<Function>()
            .map_err(js_error)?;
        let value = function
            .apply(&self.0, &js_sys::Array::from_iter(args.iter()))
            .map_err(js_error)?;
        JsFuture::from(Promise::resolve(&value))
            .await
            .map_err(js_error)
    }
}

fn js_error(error: JsValue) -> String {
    error.as_string().unwrap_or_else(|| format!("{error:?}"))
}

#[async_trait(?Send)]
impl crate::HostCapabilities for JsHost {
    async fn read(&self, path: &str) -> Result<String, String> {
        self.call("read", &[JsValue::from_str(path)])
            .await?
            .as_string()
            .ok_or_else(|| "read returned non-string".to_owned())
    }
    async fn atomic_write(&self, path: &str, content: &str) -> Result<(), String> {
        self.call(
            "atomicWrite",
            &[JsValue::from_str(path), JsValue::from_str(content)],
        )
        .await
        .map(|_| ())
    }
    async fn remove(&self, path: &str) -> Result<(), String> {
        self.call("remove", &[JsValue::from_str(path)])
            .await
            .map(|_| ())
    }
    async fn exists(&self, path: &str) -> Result<bool, String> {
        self.call("exists", &[JsValue::from_str(path)])
            .await?
            .as_bool()
            .ok_or_else(|| "exists returned non-boolean".to_owned())
    }
    async fn mkdir(&self, path: &str) -> Result<(), String> {
        self.call("mkdir", &[JsValue::from_str(path)])
            .await
            .map(|_| ())
    }
    async fn fetch(&self, url: &str) -> Result<crate::HttpResponse, String> {
        serde_wasm_bindgen::from_value(self.call("fetch", &[JsValue::from_str(url)]).await?)
            .map_err(|error| error.to_string())
    }
    async fn fetch_bytes(&self, url: &str) -> Result<Vec<u8>, String> {
        Ok(Uint8Array::new(&self.call("fetchBytes", &[JsValue::from_str(url)]).await?).to_vec())
    }
    async fn read_bytes(&self, path: &str) -> Result<Vec<u8>, String> {
        Ok(Uint8Array::new(&self.call("readBytes", &[JsValue::from_str(path)]).await?).to_vec())
    }
    async fn read_dir(&self, path: &str) -> Result<Vec<String>, String> {
        serde_wasm_bindgen::from_value(self.call("readDir", &[JsValue::from_str(path)]).await?)
            .map_err(|error| error.to_string())
    }
    async fn stat(&self, path: &str) -> Result<crate::FileType, String> {
        match self
            .call("stat", &[JsValue::from_str(path)])
            .await?
            .as_string()
            .as_deref()
        {
            Some("file") => Ok(crate::FileType::File),
            Some("directory") => Ok(crate::FileType::Directory),
            Some("symlink") => Ok(crate::FileType::Symlink),
            _ => Err("stat returned an invalid file type".to_owned()),
        }
    }
    async fn atomic_write_bytes(&self, path: &str, content: &[u8]) -> Result<(), String> {
        self.call(
            "atomicWriteBytes",
            &[JsValue::from_str(path), Uint8Array::from(content).into()],
        )
        .await
        .map(|_| ())
    }
    async fn stdout(&self, content: &str) -> Result<(), String> {
        self.call("stdout", &[JsValue::from_str(content)])
            .await
            .map(|_| ())
    }
    async fn stderr(&self, content: &str) -> Result<(), String> {
        self.call("stderr", &[JsValue::from_str(content)])
            .await
            .map(|_| ())
    }
}

#[wasm_bindgen]
pub async fn execute(
    args: JsValue,
    capabilities: JsValue,
    cwd: String,
    context: JsValue,
) -> Result<JsValue, JsValue> {
    let args: Vec<String> = serde_wasm_bindgen::from_value(args)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let context: crate::ExecutionContext = serde_wasm_bindgen::from_value(context)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    crate::execute_with_context(&args, &JsHost(capabilities), &cwd, context)
        .await
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|error| JsValue::from_str(&error.to_string()))
}
